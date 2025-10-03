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
   * Debug logging helper - checks plugin debug setting
   */
  debugLog(message, ...args) {
    if (this.config.debug) {
      this.log.info(`[DEBUG] ${message}`, ...args);
    }
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
    this.debugLog(`Device configuration:`, this.config.devices);

    try {
      // Setup each configured device
      for (let i = 0; i < this.config.devices.length; i++) {
        const deviceConfig = this.config.devices[i];
        this.debugLog(`[${i + 1}/${this.config.devices.length}] Setting up device: ${deviceConfig.deviceId}`);
        await this.setupDevice(deviceConfig);
      }

      this.log.info(`Device setup completed. Total accessories: ${this.accessories.length}`);
      this.debugLog(`Accessories list:`, this.accessories.map(acc => ({ name: acc.name, deviceId: acc.deviceId })));

      // Start polling for state updates
      this.log.info('Starting polling for state updates...');
      this.startPolling();

      this.log.info(`Configured ${this.accessories.length} device(s)`);

      // Start webhook server if enabled (after devices are configured)
      if (this.config.webhooks && this.config.webhooks.enabled) {
        this.log.info('Starting webhook server...');
        this.webhookServer = new WebhookServer(this, this.config.webhooks);
        await this.webhookServer.start();
      } else {
        this.debugLog('Webhook server disabled in configuration');
      }
    } catch (error) {
      this.log.error('Failed to discover devices:', error.message);
      this.debugLog('Error details:', error);
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

      this.debugLog(`Setting up device: ${deviceConfig.deviceId}`);

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
          this.debugLog(`Removing existing service: ${service.UUID}`);
          platformAccessory.removeService(service);
        }
      }
      
      // Add new services
      for (let i = 1; i < services.length; i++) {
        const service = services[i];
        this.debugLog(`Adding service: ${service.UUID} (${service.displayName})`);
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
    this.debugLog(`Accessories count: ${this.accessories.length}`);
    this.debugLog(`Polling configuration:`, this.config.polling);

    // Clear existing interval if any
    if (this.pollingInterval) {
      this.debugLog(`Clearing existing polling interval: ${this.pollingInterval}`);
      clearInterval(this.pollingInterval);
    }

    // Poll immediately
    this.debugLog('Performing initial poll...');
    this.pollDevices();

    // Setup interval
    this.pollingInterval = setInterval(() => {
      this.debugLog('Polling interval triggered');
      this.pollDevices();
    }, interval);
    
    this.log.info(`Polling interval set with ID: ${this.pollingInterval}`);
    this.debugLog(`Next poll will occur in ${interval / 1000} seconds`);
  }

  /**
   * Poll all devices for state updates
   */
  async pollDevices() {
    this.debugLog(`=== POLLING START ===`);
    this.debugLog(`Polling devices for state updates... Found ${this.accessories.length} accessories`);

    if (this.accessories.length === 0) {
      this.log.warn('No accessories found for polling - this might indicate a configuration issue');
      this.debugLog(`Accessories array:`, this.accessories);
      this.debugLog(`Platform accessories map size:`, this.platformAccessories.size);
      return;
    }

    this.debugLog(`Starting to poll ${this.accessories.length} accessories...`);

    for (let i = 0; i < this.accessories.length; i++) {
      const accessory = this.accessories[i];
      try {
        this.debugLog(`[${i + 1}/${this.accessories.length}] Polling device: ${accessory.name} (${accessory.deviceId})`);
        const startTime = Date.now();
        
        const status = await this.seamAPI.getLockStatus(accessory.deviceId);
        const pollTime = Date.now() - startTime;
        
        this.debugLog(`[${i + 1}/${this.accessories.length}] API call completed in ${pollTime}ms for ${accessory.name}`);
        
        // Only update if we got valid data
        if (status && typeof status === 'object') {
          this.debugLog(`[${i + 1}/${this.accessories.length}] Received status for ${accessory.name}:`, JSON.stringify(status, null, 2));
          
          // Check if lock state changed before updating
          const currentLocked = accessory.isLocked;
          const newLocked = status.locked;
          
          if (typeof newLocked === 'boolean' && newLocked !== currentLocked) {
            this.log.info(`[POLLING] Detected lock state change for ${accessory.name}: ${currentLocked ? 'LOCKED' : 'UNLOCKED'} → ${newLocked ? 'LOCKED' : 'UNLOCKED'}`);
          } else {
            this.debugLog(`[${i + 1}/${this.accessories.length}] No lock state change for ${accessory.name}: ${currentLocked ? 'LOCKED' : 'UNLOCKED'}`);
          }
          
          // Use updateStateWithPriority for polling with current timestamp
          accessory.updateStateWithPriority(status, 'polling', Date.now());
          this.debugLog(`[${i + 1}/${this.accessories.length}] State update completed for ${accessory.name}`);
        } else {
          this.log.warn(`[${i + 1}/${this.accessories.length}] Invalid status received for ${accessory.name}:`, status);
        }
      } catch (error) {
        this.log.error(`[${i + 1}/${this.accessories.length}] Failed to poll device ${accessory.name}:`, error.message);
        this.debugLog(`[${i + 1}/${this.accessories.length}] Error details:`, error);
        // Don't update state on error to avoid "no response"
      }
    }
    
    this.debugLog(`=== POLLING COMPLETE ===`);
  }

  /**
   * Save webhook configuration
   */
  saveWebhookConfig(path, secret) {
    if (this.config.webhooks) {
      this.config.webhooks.path = path;
      this.config.webhooks.secret = secret;
      this.debugLog('Webhook configuration saved');
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
