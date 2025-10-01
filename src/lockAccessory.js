'use strict';

/**
 * Lock Accessory for Homebridge
 * Simple lock implementation
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
    
    // Current state
    this.isLocked = true;
    this.batteryLevel = 100;
    this.isLowBattery = false;
    this.isDoorOpen = false;
    this.supportsDoorSensor = false;
    
    // Command state
    this.isCommandInProgress = false;
    this.commandPromise = null;
    
    // Battery cache
    this.batteryCache = {
      level: 100,
      isLow: false,
      lastUpdated: 0,
      cacheTimeout: 60 * 60 * 1000 // 1 hour in milliseconds
    };

    // Device info cache
    this.deviceInfo = {
      name: config.name || 'Smart Lock',
      manufacturer: 'Seam',
      model: 'Smart Lock',
      serialNumber: this.deviceId,
      firmwareVersion: '1.0.0',
      lastUpdated: 0,
      cacheTimeout: 24 * 60 * 60 * 1000 // 24 hours in milliseconds
    };

    // Accessory will be set up later
  }

  /**
   * Debug logging helper
   */
  debugLog(message, ...args) {
    if (this.platform.log.debug) {
      this.platform.log.debug(message, ...args);
    }
  }

  /**
   * Check if battery cache is valid
   */
  isBatteryCacheValid() {
    const now = Date.now();
    return (now - this.batteryCache.lastUpdated) < this.batteryCache.cacheTimeout;
  }

  /**
   * Update battery cache
   */
  updateBatteryCache(level, isLow) {
    this.batteryCache.level = level;
    this.batteryCache.isLow = isLow;
    this.batteryCache.lastUpdated = Date.now();
    this.debugLog(`Battery cache updated: ${level}% (${isLow ? 'LOW' : 'NORMAL'})`);
  }

  /**
   * Get battery level from cache or API
   */
  async getBatteryLevelFromAPI() {
    // Check cache first
    if (this.isBatteryCacheValid()) {
      this.debugLog(`Using cached battery level: ${this.batteryCache.level}%`);
      return {
        level: this.batteryCache.level,
        isLow: this.batteryCache.isLow
      };
    }

    // Cache expired, fetch from API
    this.debugLog(`Battery cache expired, fetching from API...`);
    try {
      const status = await this.platform.seamAPI.getLockStatus(this.deviceId);
      const level = status.battery_level || 100;
      const isLow = level < 20;
      
      this.updateBatteryCache(level, isLow);
      
      return { level, isLow };
    } catch (error) {
      this.platform.log.error(`Failed to get battery level from API:`, error.message);
      // Return cached value even if expired
      return {
        level: this.batteryCache.level,
        isLow: this.batteryCache.isLow
      };
    }
  }

  /**
   * Check if device info cache is valid
   */
  isDeviceInfoCacheValid() {
    const now = Date.now();
    return (now - this.deviceInfo.lastUpdated) < this.deviceInfo.cacheTimeout;
  }

  /**
   * Check if device supports door sensor
   */
  checkDoorSensorSupport(deviceData) {
    // Check capabilities for door sensor support
    const capabilities = deviceData.capabilities || [];
    const supportsDoorSensor = capabilities.includes('door_sensor') || 
                               capabilities.includes('contact_sensor') ||
                               capabilities.includes('door_state');
    
    if (supportsDoorSensor !== this.supportsDoorSensor) {
      this.supportsDoorSensor = supportsDoorSensor;
      this.platform.log.debug(`${this.name} door sensor support: ${supportsDoorSensor ? 'YES' : 'NO'}`);
    }
    
    this.debugLog(`Device capabilities:`, capabilities);
  }

  /**
   * Update device info cache
   */
  updateDeviceInfoCache(deviceData) {
    this.deviceInfo.name = deviceData.name || this.deviceInfo.name;
    this.deviceInfo.manufacturer = deviceData.manufacturer || this.deviceInfo.manufacturer;
    this.deviceInfo.model = deviceData.model || this.deviceInfo.model;
    this.deviceInfo.serialNumber = deviceData.serial_number || this.deviceInfo.serialNumber;
    this.deviceInfo.firmwareVersion = deviceData.firmware_version || this.deviceInfo.firmwareVersion;
    this.deviceInfo.lastUpdated = Date.now();
    this.debugLog(`Device info cache updated: ${this.deviceInfo.name} (${this.deviceInfo.manufacturer} ${this.deviceInfo.model})`);
  }

  /**
   * Get device info from cache or API
   */
  async getDeviceInfoFromAPI() {
    // Check cache first
    if (this.isDeviceInfoCacheValid()) {
      this.debugLog(`Using cached device info: ${this.deviceInfo.name}`);
      return this.deviceInfo;
    }

    // Cache expired, fetch from API
    this.debugLog(`Device info cache expired, fetching from API...`);
    try {
      const deviceData = await this.platform.seamAPI.getDevice(this.deviceId);
      
      // Extract device information
      const info = {
        name: deviceData.properties?.name || this.deviceInfo.name,
        manufacturer: deviceData.properties?.manufacturer || deviceData.device_type?.manufacturer || this.deviceInfo.manufacturer,
        model: deviceData.properties?.model || deviceData.device_type?.model || this.deviceInfo.model,
        serialNumber: deviceData.properties?.serial_number || deviceData.device_id || this.deviceInfo.serialNumber,
        firmwareVersion: deviceData.properties?.firmware_version || this.deviceInfo.firmwareVersion
      };
      
      this.updateDeviceInfoCache(info);
      
      return this.deviceInfo;
    } catch (error) {
      this.platform.log.error(`Failed to get device info from API:`, error.message);
      // Return cached value even if expired
      return this.deviceInfo;
    }
  }

  /**
   * Update device info from API
   */
  async updateDeviceInfo() {
    try {
      const deviceData = await this.platform.seamAPI.getDevice(this.deviceId);
      
      this.debugLog('Raw device data from API:', JSON.stringify(deviceData, null, 2));
      
      // Extract device information
      const info = {
        name: deviceData.properties?.name || this.deviceInfo.name,
        manufacturer: deviceData.properties?.model?.manufacturer_display_name || deviceData.properties?.manufacturer || 'Seam',
        model: deviceData.properties?.model?.display_name || deviceData.properties?.model || 'Smart Lock',
        serialNumber: deviceData.properties?.serial_number || this.deviceId,
        firmwareVersion: deviceData.properties?.firmware_version || '1.0.0'
      };
      
      // Fix object references
      if (typeof info.manufacturer === 'object') {
        info.manufacturer = info.manufacturer.name || 'Seam';
      }
      if (typeof info.model === 'object') {
        info.model = info.model.display_name || info.model.name || 'Smart Lock';
      }
      
      this.platform.log.info(`Device info: ${info.manufacturer} ${info.model} (SN: ${info.serialNumber})`);
      this.platform.log.info(`Raw API response:`, JSON.stringify(deviceData, null, 2));
      this.platform.log.info(`Extracted info:`, JSON.stringify(info, null, 2));
      
      // Check if device supports door sensor
      this.checkDoorSensorSupport(deviceData);
      
      this.updateDeviceInfoCache(info);
      
      // Update name if it changed
      if (info.name !== this.name) {
        this.name = info.name;
        this.platform.log.debug(`Device name updated to: ${this.name}`);
      }
      
      this.platform.log.debug(`Device info loaded: ${this.deviceInfo.name} (${this.deviceInfo.manufacturer} ${this.deviceInfo.model})`);
    } catch (error) {
      this.platform.log.error(`Failed to load device info:`, error.message);
      this.platform.log.info(`Using default device info: ${this.deviceInfo.name}`);
    }
  }

  /**
   * Setup accessory services
   */
  async setupAccessory() {
    // Get real device info first
    await this.updateDeviceInfo();
    
    // Accessory Information Service with real data
    this.platform.log.info(`Setting HomeKit characteristics: Manufacturer=${this.deviceInfo.manufacturer}, Model=${this.deviceInfo.model}, Serial=${this.deviceInfo.serialNumber}, Firmware=${this.deviceInfo.firmwareVersion}`);
    
    this.informationService = new this.Service.AccessoryInformation()
      .setCharacteristic(this.Characteristic.Manufacturer, this.deviceInfo.manufacturer)
      .setCharacteristic(this.Characteristic.Model, this.deviceInfo.model)
      .setCharacteristic(this.Characteristic.SerialNumber, this.deviceInfo.serialNumber)
      .setCharacteristic(this.Characteristic.FirmwareRevision, this.deviceInfo.firmwareVersion);
    
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
    this.batteryService = new this.Service.Battery(this.name, 'battery');
    
    this.batteryService
      .getCharacteristic(this.Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this));

    this.batteryService
      .getCharacteristic(this.Characteristic.StatusLowBattery)
      .onGet(this.getStatusLowBattery.bind(this));

    // Contact Sensor Service (for door state) - only if device supports it
    if (this.supportsDoorSensor) {
      this.contactService = new this.Service.ContactSensor(this.name, 'door');
      
      this.contactService
        .getCharacteristic(this.Characteristic.ContactSensorState)
        .onGet(this.getContactSensorState.bind(this));
      
      this.platform.log.debug(`${this.name} door sensor enabled`);
    } else {
      this.contactService = null;
      this.platform.log.debug(`${this.name} door sensor not supported by device`);
    }

    this.platform.log.debug(`Lock accessory setup completed: ${this.name}`);
  }

  /**
   * Get all services
   */
  getServices() {
    const services = [
      this.informationService,
      this.lockService,
      this.batteryService
    ];
    
    // Add contact sensor only if device supports it
    if (this.contactService) {
      services.push(this.contactService);
    }
    
    return services;
  }

  /**
   * Get current lock state
   */
  async getLockCurrentState() {
    this.debugLog(`HomeKit requested lock current state for ${this.name}`);
    
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), 5000);
    });
    
    try {
      const statusPromise = this.platform.seamAPI.getLockStatus(this.deviceId);
      const status = await Promise.race([statusPromise, timeoutPromise]);
      
      this.isLocked = status.locked;
      
      // Update battery level if available (always update when we have fresh data)
      if (typeof status.battery_level === 'number') {
        this.batteryLevel = status.battery_level;
        this.isLowBattery = this.batteryLevel < 20;
        this.updateBatteryCache(this.batteryLevel, this.isLowBattery);
      } else {
        // Use cached battery data
        const batteryData = await this.getBatteryLevelFromAPI();
        this.batteryLevel = batteryData.level;
        this.isLowBattery = batteryData.isLow;
      }
      
      const state = this.isLocked 
        ? this.Characteristic.LockCurrentState.SECURED 
        : this.Characteristic.LockCurrentState.UNSECURED;
      
      this.debugLog(`Lock current state for ${this.name}: ${this.isLocked ? 'LOCKED' : 'UNLOCKED'} (state value: ${state})`);
      
      // Force update characteristics to ensure HomeKit gets the value
      this.lockService
        .getCharacteristic(this.Characteristic.LockCurrentState)
        .updateValue(state);
      
      this.lockService
        .getCharacteristic(this.Characteristic.LockTargetState)
        .updateValue(state);
      
      // Update battery characteristics
      this.batteryService
        .getCharacteristic(this.Characteristic.BatteryLevel)
        .updateValue(this.batteryLevel);
      
      this.batteryService
        .getCharacteristic(this.Characteristic.StatusLowBattery)
        .updateValue(this.isLowBattery 
          ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW 
          : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      
      return state;
    } catch (error) {
      this.platform.log.error(`Failed to get lock state for ${this.name}:`, error.message);
      // Return cached state instead of throwing error
      const state = this.isLocked 
        ? this.Characteristic.LockCurrentState.SECURED 
        : this.Characteristic.LockCurrentState.UNSECURED;
      this.debugLog(`Returning cached state for ${this.name}: ${this.isLocked ? 'LOCKED' : 'UNLOCKED'} (state value: ${state})`);
      
      // Force update characteristics even on error
      this.lockService
        .getCharacteristic(this.Characteristic.LockCurrentState)
        .updateValue(state);
      
      this.lockService
        .getCharacteristic(this.Characteristic.LockTargetState)
        .updateValue(state);
      
      return state;
    }
  }

  /**
   * Get target lock state
   */
  async getLockTargetState() {
    this.debugLog(`HomeKit requested lock target state for ${this.name}`);
    const state = this.isLocked 
      ? this.Characteristic.LockTargetState.SECURED 
      : this.Characteristic.LockTargetState.UNSECURED;
    this.debugLog(`Lock target state for ${this.name}: ${this.isLocked ? 'LOCKED' : 'UNLOCKED'} (state value: ${state})`);
    return state;
  }

  /**
   * Set target lock state
   */
  async setLockTargetState(value) {
    const shouldLock = value === this.Characteristic.LockTargetState.SECURED;
    
    this.platform.log.info(`HomeKit requested to ${shouldLock ? 'lock' : 'unlock'} ${this.name} (value: ${value})`);
    
    // Check if command is already in progress
    if (this.isCommandInProgress) {
      this.platform.log.warn(`Command already in progress for ${this.name}, waiting for completion...`);
      try {
        await this.commandPromise;
        this.platform.log.debug(`Previous command completed for ${this.name}`);
      } catch (error) {
        this.platform.log.error(`Previous command failed for ${this.name}:`, error.message);
        throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
      }
    }
    
    // Start new command
    this.isCommandInProgress = true;
    this.commandPromise = this.executeLockCommand(shouldLock);
    
    try {
      await this.commandPromise;
    } finally {
      this.isCommandInProgress = false;
      this.commandPromise = null;
    }
  }

  /**
   * Execute lock command with timeout
   */
  async executeLockCommand(shouldLock) {
    // Add timeout to prevent hanging
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Command timeout')), 15000);
    });
    
    try {
      const commandPromise = shouldLock 
        ? this.platform.seamAPI.lockDoor(this.deviceId)
        : this.platform.seamAPI.unlockDoor(this.deviceId);
      
      await Promise.race([commandPromise, timeoutPromise]);

      // Update state
      this.isLocked = shouldLock;
      
      // Update characteristics immediately
      const lockState = shouldLock 
        ? this.Characteristic.LockCurrentState.SECURED 
        : this.Characteristic.LockCurrentState.UNSECURED;
      
      this.lockService
        .getCharacteristic(this.Characteristic.LockCurrentState)
        .updateValue(lockState);
      
      this.lockService
        .getCharacteristic(this.Characteristic.LockTargetState)
        .updateValue(lockState);
      
      this.platform.log.info(`${this.name} ${shouldLock ? 'locked' : 'unlocked'} successfully`);
      
      // Add small delay to allow API to update before polling can interfere
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      this.platform.log.error(`Failed to ${shouldLock ? 'lock' : 'unlock'} ${this.name}:`, error.message);
      // Throw HAP error to indicate failure to HomeKit
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  /**
   * Get battery level
   */
  async getBatteryLevel() {
    this.debugLog(`HomeKit requested battery level for ${this.name}`);
    
    // Get battery data from cache or API
    const batteryData = await this.getBatteryLevelFromAPI();
    this.batteryLevel = batteryData.level;
    this.isLowBattery = batteryData.isLow;
    
    this.debugLog(`Battery level for ${this.name}: ${this.batteryLevel}%`);
    return this.batteryLevel;
  }

  /**
   * Get low battery status
   */
  async getStatusLowBattery() {
    this.debugLog(`HomeKit requested low battery status for ${this.name}`);
    
    // Get battery data from cache or API
    const batteryData = await this.getBatteryLevelFromAPI();
    this.batteryLevel = batteryData.level;
    this.isLowBattery = batteryData.isLow;
    
    const status = this.isLowBattery 
      ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW 
      : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
    this.debugLog(`Low battery status for ${this.name}: ${this.isLowBattery ? 'LOW' : 'NORMAL'}`);
    return status;
  }

  /**
   * Get contact sensor state (door open/closed)
   */
  async getContactSensorState() {
    this.debugLog(`HomeKit requested contact sensor state for ${this.name}`);
    const state = this.isDoorOpen 
      ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED 
      : this.Characteristic.ContactSensorState.CONTACT_DETECTED;
    this.debugLog(`Contact sensor state for ${this.name}: ${this.isDoorOpen ? 'DOOR OPEN' : 'DOOR CLOSED'} (state value: ${state})`);
    return state;
  }

  /**
   * Update state from external source (webhook or polling)
   */
  updateState(state) {
    this.debugLog(`Updating state for ${this.name}:`, state);
    
    // Skip state update if command is in progress to avoid race conditions
    if (this.isCommandInProgress) {
      this.debugLog(`Command in progress, skipping state update for ${this.name}`);
      return;
    }
    
    // Update lock state
    if (typeof state.locked === 'boolean' && state.locked !== this.isLocked) {
      this.isLocked = state.locked;
      
      const lockState = this.isLocked 
        ? this.Characteristic.LockCurrentState.SECURED 
        : this.Characteristic.LockCurrentState.UNSECURED;
      
      this.lockService
        .getCharacteristic(this.Characteristic.LockCurrentState)
        .updateValue(lockState);
      
      this.lockService
        .getCharacteristic(this.Characteristic.LockTargetState)
        .updateValue(lockState);
      
      this.platform.log.debug(`${this.name} state updated: ${this.isLocked ? 'LOCKED' : 'UNLOCKED'}`);
    }

    // Update battery level
    if (typeof state.battery_level === 'number' && state.battery_level !== this.batteryLevel) {
      this.batteryLevel = state.battery_level;
      this.isLowBattery = this.batteryLevel < 20;
      
      // Update cache with fresh data
      this.updateBatteryCache(this.batteryLevel, this.isLowBattery);
      
      this.batteryService
        .getCharacteristic(this.Characteristic.BatteryLevel)
        .updateValue(this.batteryLevel);
      
      this.batteryService
        .getCharacteristic(this.Characteristic.StatusLowBattery)
        .updateValue(this.isLowBattery 
          ? this.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW 
          : this.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL);
      
      this.platform.log.debug(`${this.name} battery updated: ${this.batteryLevel}% (${this.isLowBattery ? 'LOW' : 'NORMAL'})`);
    }

    // Update door state (only if device supports door sensor)
    if (this.contactService && typeof state.door_open === 'boolean' && state.door_open !== this.isDoorOpen) {
      this.isDoorOpen = state.door_open;
      
      const contactState = this.isDoorOpen 
        ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED 
        : this.Characteristic.ContactSensorState.CONTACT_DETECTED;
      
      this.contactService
        .getCharacteristic(this.Characteristic.ContactSensorState)
        .updateValue(contactState);
      
      this.platform.log.debug(`${this.name} door state updated: ${this.isDoorOpen ? 'OPEN' : 'CLOSED'}`);
    }
  }

  /**
   * Update HomeKit characteristics with current device info
   */
  updateHomeKitCharacteristics() {
    if (!this.informationService) {
      this.platform.log.warn(`Information service not available for ${this.name}`);
      return;
    }

    try {
      this.debugLog('Updating HomeKit characteristics:', {
        manufacturer: this.deviceInfo.manufacturer,
        model: this.deviceInfo.model,
        serialNumber: this.deviceInfo.serialNumber,
        firmware: this.deviceInfo.firmwareVersion
      });
      
      this.informationService
        .getCharacteristic(this.Characteristic.Manufacturer)
        .updateValue(this.deviceInfo.manufacturer);
      
      this.informationService
        .getCharacteristic(this.Characteristic.Model)
        .updateValue(this.deviceInfo.model);
      
      this.informationService
        .getCharacteristic(this.Characteristic.SerialNumber)
        .updateValue(this.deviceInfo.serialNumber);
      
      this.informationService
        .getCharacteristic(this.Characteristic.FirmwareRevision)
        .updateValue(this.deviceInfo.firmwareVersion);
      
      this.platform.log.debug(`HomeKit characteristics updated: ${this.deviceInfo.manufacturer} ${this.deviceInfo.model} (${this.deviceInfo.serialNumber})`);
    } catch (error) {
      this.platform.log.error(`Failed to update HomeKit characteristics:`, error.message);
    }
  }

  /**
   * Force refresh device info
   */
  async refreshDeviceInfo() {
    this.platform.log.debug(`Refreshing device info for ${this.name}...`);
    await this.updateDeviceInfo();
    this.updateHomeKitCharacteristics();
  }

  /**
   * Get UUID for this accessory
   */
  getUUID() {
    // Use a fixed UUID to avoid conflicts
    return this.platform.api.hap.uuid.generate('seam-lock-' + this.deviceId);
  }
}

module.exports = LockAccessory;