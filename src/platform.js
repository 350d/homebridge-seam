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

      // Start webhook server if enabled
      if (this.config.webhooks && this.config.webhooks.enabled) {
        this.webhookServer = new WebhookServer(this, this.config.webhooks);
        await this.webhookServer.start();
      }

      this.log.info(`Successfully configured ${this.accessories.length} device(s)`);
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

      this.log.info(`Setting up device: ${deviceConfig.deviceId}`);

      // Get device info from Seam
      const device = await this.seamAPI.getDevice(deviceConfig.deviceId);
      
      if (!device) {
        this.log.error(`Device ${deviceConfig.deviceId} not found in Seam`);
        return;
      }

      // Create lock accessory
      const lockAccessory = new LockAccessory(this, device, deviceConfig);
      const uuid = lockAccessory.getUUID();

      // Check if accessory already exists in cache
      let platformAccessory = this.platformAccessories.get(uuid);

      if (platformAccessory) {
        // Update existing accessory
        this.log.info(`Restoring existing accessory: ${lockAccessory.name}`);
        platformAccessory.displayName = lockAccessory.name;
        platformAccessory.context.device = device;
        platformAccessory.context.deviceId = deviceConfig.deviceId;
      } else {
        // Create new platform accessory
        this.log.info(`Registering new accessory: ${lockAccessory.name}`);
        platformAccessory = new this.api.platformAccessory(
          lockAccessory.name,
          uuid
        );
        platformAccessory.context.device = device;
        platformAccessory.context.deviceId = deviceConfig.deviceId;
        
        // Register with homebridge
        this.api.registerPlatformAccessories('homebridge-seam', 'SeamLock', [platformAccessory]);
        this.platformAccessories.set(uuid, platformAccessory);
      }

      // Add services to platform accessory
      const services = lockAccessory.getServices();
      platformAccessory.services = [platformAccessory.getService(this.api.hap.Service.AccessoryInformation) || services[0]];
      
      for (let i = 1; i < services.length; i++) {
        const existingService = platformAccessory.getService(services[i].UUID);
        if (existingService) {
          platformAccessory.removeService(existingService);
        }
        platformAccessory.addService(services[i]);
      }

      // Store accessory reference
      this.accessories.push(lockAccessory);

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

    // Clear existing interval if any
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
    }

    // Poll immediately
    this.pollDevices();

    // Setup interval
    this.pollingInterval = setInterval(() => {
      this.pollDevices();
    }, interval);
  }

  /**
   * Poll all devices for state updates
   */
  async pollDevices() {
    if (this.config.debug) {
      this.log.debug('Polling devices for state updates...');
    }

    for (const accessory of this.accessories) {
      try {
        const status = await this.seamAPI.getLockStatus(accessory.deviceId);
        accessory.updateState(status);
        
        if (this.config.debug) {
          this.log.debug(`Updated state for ${accessory.name}:`, status);
        }
      } catch (error) {
        this.log.error(`Failed to poll device ${accessory.name}:`, error.message);
      }
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
