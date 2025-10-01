'use strict';

const SeamAPI = require('./seamapi');
const LockAccessory = require('./lockAccessory');
const WebhookServer = require('./webhookServer');

/**
 * Seam Platform for Homebridge
 * Main platform class that manages all lock accessories
 */
class SeamPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    
    // Storage
    this.accessories = [];
    this.platformAccessories = new Map();
    this.pollingInterval = null;
    this.webhookServer = null;

    // Validate config
    if (!config) {
      this.log.error('No configuration found for platform');
      return;
    }

    if (!config.apiKey) {
      this.log.error('Seam API key is required in configuration');
      return;
    }

    if (!config.devices || !Array.isArray(config.devices) || config.devices.length === 0) {
      this.log.error('At least one device must be configured');
      return;
    }

    // Initialize Seam API
    this.seamAPI = new SeamAPI(config.apiKey, this.log);
    this.log.info('Seam API initialized');

    // Wait for homebridge to finish launching
    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });

    // Cleanup on shutdown
    this.api.on('shutdown', () => {
      this.cleanup();
    });
  }

  /**
   * Configure cached accessory (restored from disk)
   */
  configureAccessory(accessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.platformAccessories.set(accessory.UUID, accessory);
  }

  /**
   * Clear all cached accessories
   */
  clearCachedAccessories() {
    this.log.info('Clearing all cached accessories...');
    
    // Unregister all platform accessories
    const accessoriesToRemove = Array.from(this.platformAccessories.values());
    if (accessoriesToRemove.length > 0) {
      this.log.info(`Unregistering ${accessoriesToRemove.length} cached accessories`);
      this.api.unregisterPlatformAccessories('@350d/homebridge-seam', 'SeamLock', accessoriesToRemove);
    }
    
    // Clear internal storage
    this.platformAccessories.clear();
    this.accessories = [];
    
    this.log.info('All cached accessories cleared');
  }

  /**
   * Discover and setup devices
   */
  async discoverDevices() {
    this.log.info('Discovering devices...');

    try {
      // Setup each configured device
      for (const deviceConfig of this.config.devices) {
        await this.setupDevice(deviceConfig);
      }

      // Start polling for state updates
      this.startPolling();

      this.log.info(`Configured ${this.accessories.length} device(s)`);

      // Start webhook server if enabled (after devices are configured)
      if (this.config.webhooks && this.config.webhooks.enabled) {
        this.webhookServer = new WebhookServer(this, this.config.webhooks);
        await this.webhookServer.start();
      }
    } catch (error) {
      this.log.error('Failed to discover devices:', error.message);
    }
  }

  /**
   * Setup individual device
   */
  async setupDevice(deviceConfig) {
    try {
      if (!deviceConfig.deviceId) {
        this.log.warn('Device configuration missing deviceId, skipping');
        return;
      }

      this.log.debug(`Setting up device: ${deviceConfig.deviceId}`);

      // Get device info from Seam
      const device = await this.seamAPI.getDevice(deviceConfig.deviceId);
      
      if (!device) {
        this.log.error(`Device ${deviceConfig.deviceId} not found in Seam`);
        return;
      }

      // Create lock accessory
      const lockAccessory = new LockAccessory(this, device, deviceConfig);
      await lockAccessory.setupAccessory(); // Wait for device info to load
      const uuid = lockAccessory.getUUID();

      // Check if accessory already exists in cache
      let platformAccessory = this.platformAccessories.get(uuid);

      if (platformAccessory) {
        // Update existing accessory
        this.log.info(`Restoring existing accessory: ${lockAccessory.name}`);
        platformAccessory.displayName = lockAccessory.name;
        platformAccessory.context.device = device;
        platformAccessory.context.deviceId = deviceConfig.deviceId;
        
        // Add to accessories array for polling
        this.accessories.push(lockAccessory);
      } else {
        // Create new platform accessory
        this.log.info(`Creating new platform accessory: ${lockAccessory.name}`);
        platformAccessory = new this.api.platformAccessory(
          lockAccessory.name,
          uuid
        );
        platformAccessory.context.device = device;
        platformAccessory.context.deviceId = deviceConfig.deviceId;
        
        // Register with homebridge
        this.log.info(`Registering new accessory with HomeKit: ${lockAccessory.name} (${uuid})`);
        this.api.registerPlatformAccessories('@350d/homebridge-seam', 'SeamLock', [platformAccessory]);
        this.platformAccessories.set(uuid, platformAccessory);
        
        // Add to accessories array for polling
        this.accessories.push(lockAccessory);
        this.log.info(`Accessory ${lockAccessory.name} registered successfully`);
      }

      // Add services to platform accessory
      const services = lockAccessory.getServices();
      
      this.log.info(`Adding ${services.length} services to platform accessory for ${lockAccessory.name}`);
      
      // Clear all services except AccessoryInformation
      const existingServices = platformAccessory.services.slice();
      for (const service of existingServices) {
        if (service.UUID !== this.api.hap.Service.AccessoryInformation.UUID) {
          this.log.debug(`Removing existing service: ${service.UUID}`);
          platformAccessory.removeService(service);
        }
      }
      
      // Add new services
      for (let i = 1; i < services.length; i++) {
        const service = services[i];
        this.log.debug(`Adding service: ${service.UUID} (${service.displayName})`);
        platformAccessory.addService(service);
      }
      
      this.log.info(`Platform accessory now has ${platformAccessory.services.length} services`);

      this.log.info(`Device ${lockAccessory.name} configured successfully`);
    } catch (error) {
      this.log.error(`Failed to setup device ${deviceConfig.deviceId}:`, error.message);
    }
  }

  /**
   * Start polling for device state updates
   */
  startPolling() {
    const interval = (this.config.polling?.interval || 60) * 1000; // Convert to milliseconds
    
    this.log.info(`Starting state polling every ${interval / 1000} seconds`);
    this.log.debug(`Accessories count: ${this.accessories.length}`);

    // Clear existing interval if any
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    // Poll immediately
    this.pollDevices();

    // Setup interval
    this.pollingInterval = setInterval(() => {
      this.log.debug('Polling interval triggered');
      this.pollDevices();
    }, interval);
    
    this.log.debug(`Polling interval set with ID: ${this.pollingInterval}`);
  }

  /**
   * Poll all devices for state updates
   */
  async pollDevices() {
    this.log.debug(`Polling devices for state updates... Found ${this.accessories.length} accessories`);

    if (this.accessories.length === 0) {
      this.log.warn('No accessories found for polling');
      return;
    }

    for (const accessory of this.accessories) {
      try {
        this.log.debug(`Polling device: ${accessory.name} (${accessory.deviceId})`);
        const status = await this.seamAPI.getLockStatus(accessory.deviceId);
        
        // Only update if we got valid data
        if (status && typeof status === 'object') {
          this.log.debug(`Received status for ${accessory.name}:`, JSON.stringify(status, null, 2));
          
          // Check if lock state changed before updating
          const currentLocked = accessory.isLocked;
          const newLocked = status.locked;
          
          if (typeof newLocked === 'boolean' && newLocked !== currentLocked) {
            this.log.info(`Polling detected lock state change for ${accessory.name}: ${currentLocked ? 'LOCKED' : 'UNLOCKED'} → ${newLocked ? 'LOCKED' : 'UNLOCKED'}`);
          }
          
          accessory.updateState(status);
          this.log.debug(`State update completed for ${accessory.name}`);
        } else {
          this.log.warn(`Invalid status received for ${accessory.name}:`, status);
        }
      } catch (error) {
        this.log.error(`Failed to poll device ${accessory.name}:`, error.message);
        // Don't update state on error to avoid "no response"
      }
    }
  }

  /**
   * Save webhook configuration
   */
  saveWebhookConfig(path, secret) {
    if (this.config.webhooks) {
      this.config.webhooks.path = path;
      this.config.webhooks.secret = secret;
      this.log.debug('Webhook configuration saved');
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    this.log.info('Cleaning up platform resources...');

    // Stop polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    // Stop webhook server
    if (this.webhookServer) {
      await this.webhookServer.stop();
      this.webhookServer = null;
    }

    this.log.info('Platform cleanup completed');
  }
}

module.exports = SeamPlatform;
