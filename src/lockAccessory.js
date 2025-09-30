'use strict';

/**
 * Lock Accessory for Homebridge
 * Manages lock state, battery level, and door sensor
 */
class LockAccessory {
  constructor(platform, device, config) {
    this.platform = platform;
    this.device = device;
    this.config = config;
    this.deviceId = config.deviceId;
    this.name = config.name || device.properties?.name || 'Smart Lock';
    
    this.Service = platform.api.hap.Service;
    this.Characteristic = platform.api.hap.Characteristic;
    
    // Current state cache
    this.currentState = {
      locked: true,
      battery_level: 100,
      door_open: false,
      online: true
    };

    // Setup accessory
    this.setupAccessory();
  }

  /**
   * Setup accessory services
   */
  setupAccessory() {
    // Accessory Information Service
    this.informationService = new this.Service.AccessoryInformation()
      .setCharacteristic(this.Characteristic.Manufacturer, this.device.properties?.manufacturer || 'Seam')
      .setCharacteristic(this.Characteristic.Model, this.device.properties?.model || 'Smart Lock')
      .setCharacteristic(this.Characteristic.SerialNumber, this.deviceId)
      .setCharacteristic(this.Characteristic.FirmwareRevision, this.device.properties?.firmware_version || '1.0.0');

    // Lock Mechanism Service
    this.lockService = new this.Service.LockMechanism(this.name);
    
    this.lockService
      .getCharacteristic(this.Characteristic.LockCurrentState)
      .onGet(this.getLockCurrentState.bind(this));

    this.lockService
      .getCharacteristic(this.Characteristic.LockTargetState)
      .onGet(this.getLockTargetState.bind(this))
      .onSet(this.setLockTargetState.bind(this));

    // Battery Service
    this.batteryService = new this.Service.Battery(this.name);
    
    this.batteryService
      .getCharacteristic(this.Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this));

    this.batteryService
      .getCharacteristic(this.Characteristic.StatusLowBattery)
      .onGet(this.getStatusLowBattery.bind(this));

    this.batteryService
      .getCharacteristic(this.Characteristic.ChargingState)
      .onGet(() => this.Characteristic.ChargingState.NOT_CHARGEABLE);

    // Contact Sensor Service (door open/closed)
    this.contactService = new this.Service.ContactSensor(this.name + ' Door');
    
    this.contactService
      .getCharacteristic(this.Characteristic.ContactSensorState)
      .onGet(this.getContactSensorState.bind(this));

    this.platform.log.info(`Lock accessory setup completed: ${this.name}`);
  }

  /**
   * Get all services
   */
  getServices() {
    return [
      this.informationService,
      this.lockService,
      this.batteryService,
      this.contactService
    ];
  }

  /**
   * Get current lock state
   */
  async getLockCurrentState() {
    try {
      const status = await this.platform.seamAPI.getLockStatus(this.deviceId);
      this.currentState = status;
      
      const state = status.locked 
        ? this.Characteristic.LockCurrentState.SECURED 
        : this.Characteristic.LockCurrentState.UNSECURED;
      
      this.platform.log.debug(`Lock current state for ${this.name}: ${status.locked ? 'LOCKED' : 'UNLOCKED'}`);
      return state;
    } catch (error) {
      this.platform.log.error(`Failed to get lock state for ${this.name}:`, error.message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Get target lock state
   */
  async getLockTargetState() {
    const state = this.currentState.locked 
      ? this.Characteristic.LockTargetState.SECURED 
      : this.Characteristic.LockTargetState.UNSECURED;
    return state;
  }

  /**
   * Set target lock state
   */
  async setLockTargetState(value) {
    try {
      const shouldLock = value === this.Characteristic.LockTargetState.SECURED;
      
      this.platform.log.info(`${shouldLock ? 'Locking' : 'Unlocking'} ${this.name}...`);
      
      if (shouldLock) {
        await this.platform.seamAPI.lockDoor(this.deviceId);
      } else {
        await this.platform.seamAPI.unlockDoor(this.deviceId);
      }

      // Update state
      this.currentState.locked = shouldLock;
      
      // Update current state characteristic
      setTimeout(() => {
        const currentState = shouldLock 
          ? this.Characteristic.LockCurrentState.SECURED 
          : this.Characteristic.LockCurrentState.UNSECURED;
        this.lockService
          .getCharacteristic(this.Characteristic.LockCurrentState)
          .updateValue(currentState);
      }, 1000);

      this.platform.log.info(`${this.name} ${shouldLock ? 'locked' : 'unlocked'} successfully`);
    } catch (error) {
      this.platform.log.error(`Failed to ${value === this.Characteristic.LockTargetState.SECURED ? 'lock' : 'unlock'} ${this.name}:`, error.message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Get battery level
   */
  async getBatteryLevel() {
    try {
      const status = await this.platform.seamAPI.getLockStatus(this.deviceId);
      this.currentState.battery_level = status.battery_level || 100;
      
      this.platform.log.debug(`Battery level for ${this.name}: ${this.currentState.battery_level}%`);
      return this.currentState.battery_level;
    } catch (error) {
      this.platform.log.error(`Failed to get battery level for ${this.name}:`, error.message);
      return this.currentState.battery_level;
    }
  }

  /**
   * Get low battery status
   */
  async getStatusLowBattery() {
    const batteryLevel = await this.getBatteryLevel();
    const isLow = batteryLevel < 20 
      ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW 
      : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    
    return isLow;
  }

  /**
   * Get contact sensor state (door open/closed)
   */
  async getContactSensorState() {
    try {
      const status = await this.platform.seamAPI.getLockStatus(this.deviceId);
      this.currentState.door_open = status.door_open || false;
      
      const state = this.currentState.door_open 
        ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED  // Door open
        : this.Characteristic.ContactSensorState.CONTACT_DETECTED;     // Door closed
      
      this.platform.log.debug(`Door state for ${this.name}: ${this.currentState.door_open ? 'OPEN' : 'CLOSED'}`);
      return state;
    } catch (error) {
      this.platform.log.error(`Failed to get door state for ${this.name}:`, error.message);
      return this.Characteristic.ContactSensorState.CONTACT_DETECTED;
    }
  }

  /**
   * Update state from external source (webhook or polling)
   */
  updateState(state) {
    this.platform.log.debug(`Updating state for ${this.name}:`, state);
    
    // Update lock state
    if (typeof state.locked === 'boolean' && state.locked !== this.currentState.locked) {
      this.currentState.locked = state.locked;
      const lockState = state.locked 
        ? this.Characteristic.LockCurrentState.SECURED 
        : this.Characteristic.LockCurrentState.UNSECURED;
      
      this.lockService
        .getCharacteristic(this.Characteristic.LockCurrentState)
        .updateValue(lockState);
      
      this.lockService
        .getCharacteristic(this.Characteristic.LockTargetState)
        .updateValue(lockState);
      
      this.platform.log.info(`${this.name} state updated: ${state.locked ? 'LOCKED' : 'UNLOCKED'}`);
    }

    // Update battery level
    if (typeof state.battery_level === 'number' && state.battery_level !== this.currentState.battery_level) {
      this.currentState.battery_level = state.battery_level;
      
      this.batteryService
        .getCharacteristic(this.Characteristic.BatteryLevel)
        .updateValue(state.battery_level);
      
      const isLow = state.battery_level < 20 
        ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW 
        : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
      
      this.batteryService
        .getCharacteristic(this.Characteristic.StatusLowBattery)
        .updateValue(isLow);
      
      this.platform.log.info(`${this.name} battery updated: ${state.battery_level}%`);
    }

    // Update door open state
    if (typeof state.door_open === 'boolean' && state.door_open !== this.currentState.door_open) {
      this.currentState.door_open = state.door_open;
      
      const contactState = state.door_open 
        ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED 
        : this.Characteristic.ContactSensorState.CONTACT_DETECTED;
      
      this.contactService
        .getCharacteristic(this.Characteristic.ContactSensorState)
        .updateValue(contactState);
      
      this.platform.log.info(`${this.name} door state updated: ${state.door_open ? 'OPEN' : 'CLOSED'}`);
    }
  }

  /**
   * Get UUID for this accessory
   */
  getUUID() {
    return this.platform.api.hap.uuid.generate(this.deviceId);
  }
}

module.exports = LockAccessory;
