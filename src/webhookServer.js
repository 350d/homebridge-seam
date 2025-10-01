'use strict';

const http = require('http');
const crypto = require('crypto');

/**
 * Simple HTTP server for receiving Seam webhooks
 * Uses native http module without external dependencies
 */
class WebhookServer {
  constructor(platform, config) {
    this.platform = platform;
    this.config = config;
    this.server = null;
    this.webhookId = null;
    this.port = config.port || 8080;
    this.path = config.path || null; // Use saved path or generate new
    this.webhookUrl = null; // Will be constructed from base URL + path
    this.secret = config.secret || null; // Use saved secret or generate new
  }

  /**
   * Generate webhook secret
   */
  generateSecret() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Generate random webhook path
   */
  generatePath() {
    return '/' + crypto.randomUUID();
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload, signature) {
    if (!this.secret) {
      this.platform.log.warn('Webhook secret not configured, skipping signature verification');
      return true;
    }

    if (!signature) {
      this.platform.log.error('Webhook signature missing');
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.secret)
        .update(payload, 'utf8')
        .digest('hex');

      const providedSignature = signature.replace('sha256=', '');
      
      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature, 'hex')
      );

      if (!isValid) {
        this.platform.log.error('Invalid webhook signature');
      }

      return isValid;
    } catch (error) {
      this.platform.log.error('Failed to verify webhook signature:', error.message);
      return false;
    }
  }

  /**
   * Start webhook server
   */
  async start() {
    this.platform.log.debug(`Webhook server config: enabled=${this.config.enabled}, port=${this.port}, baseUrl=${this.config.url || 'not configured'}`);
    
    if (!this.config.enabled) {
      this.platform.log.info('Webhook server is disabled in config');
      // Clean up any existing webhook and clear config
      await this.cleanupWebhook();
      this.platform.saveWebhookConfig('', '');
      // Clear local values
      this.path = null;
      this.secret = null;
      return;
    }

    if (!this.config.url) {
      this.platform.log.error('Webhook base URL is required when webhooks are enabled');
      return;
    }

    try {
      // Always generate new path/secret when starting (for security)
      this.path = this.generatePath();
      this.secret = this.generateSecret();
      this.platform.log.debug(`Generated new webhook path: ${this.path}`);
      this.platform.log.debug(`Generated new webhook secret: ${this.secret}`);
      
      // Construct full URL
      this.webhookUrl = this.config.url + this.path;

      // Create HTTP server
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Start listening
      await new Promise((resolve, reject) => {
        this.server.listen(this.port, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      this.platform.log.info(`Webhook server started on port ${this.port}`);
      this.platform.log.debug(`Webhook path: ${this.path}`);

      // Register webhook with Seam
      await this.registerWebhook();
    } catch (error) {
      this.platform.log.error('Failed to start webhook server:', error.message);
      throw error;
    }
  }

  /**
   * Handle incoming HTTP request
   */
  handleRequest(req, res) {
    this.platform.log.debug(`Webhook request: ${req.method} ${req.url} from ${req.connection.remoteAddress}`);
    
    // Only handle POST requests to webhook path
    if (req.method !== 'POST' || req.url !== this.path) {
      this.platform.log.debug(`Webhook request rejected: ${req.method} ${req.url} (expected POST ${this.path})`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', () => {
            try {
                // Log headers for debugging
                this.platform.log.debug('Webhook headers:', JSON.stringify(req.headers, null, 2));
                
                // Verify webhook signature (optional for now)
                const signature = req.headers['x-seam-signature'] || req.headers['x-hub-signature-256'];
                if (signature && !this.verifySignature(body, signature)) {
                  this.platform.log.error('Webhook signature verification failed');
                  res.writeHead(401, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Unauthorized' }));
                  return;
                } else if (!signature) {
                  this.platform.log.debug('Webhook received without signature (signature verification disabled)');
                }

        const payload = JSON.parse(body);
        this.platform.log.debug('Webhook received:', payload);

        // Process webhook
        this.processWebhook(payload);

        // Send response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (error) {
        this.platform.log.error('Failed to process webhook:', error.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad Request' }));
      }
    });
  }

  /**
   * Process webhook payload
   */
  processWebhook(payload) {
    this.platform.log.debug(`Processing webhook payload:`, JSON.stringify(payload, null, 2));
    
    if (!payload || !payload.event_type) {
      this.platform.log.warn('Invalid webhook payload received');
      return;
    }

    const eventType = payload.event_type;
    const deviceId = payload.device_id;

    this.platform.log.info(`Webhook event: ${eventType} for device ${deviceId}`);

    // Find accessory
    const accessory = this.platform.accessories.find(acc => acc.deviceId === deviceId);
    if (!accessory) {
      this.platform.log.warn(`No accessory found for device ${deviceId}. Available accessories:`, this.platform.accessories.map(acc => acc.deviceId));
      return;
    }

    // Update accessory state based on event type
    switch (eventType) {
      case 'lock.locked':
        accessory.updateState({ locked: true });
        break;
      
      case 'lock.unlocked':
        accessory.updateState({ locked: false });
        break;
      
      case 'device.connected':
        accessory.updateState({ online: true });
        this.platform.log.info(`Device ${deviceId} connected`);
        break;
      
      case 'device.disconnected':
        accessory.updateState({ online: false });
        this.platform.log.warn(`Device ${deviceId} disconnected`);
        break;
      
      case 'device.low_battery':
        if (payload.battery_level) {
          accessory.updateState({ battery_level: payload.battery_level });
        }
        this.platform.log.warn(`Device ${deviceId} has low battery`);
        break;
      
      case 'device.battery_status_changed':
        if (payload.battery_level) {
          accessory.updateState({ battery_level: payload.battery_level });
          this.platform.log.info(`Device ${deviceId} battery level updated: ${Math.round(payload.battery_level * 100)}%`);
        }
        break;
      
      case 'device.door_opened':
        if (accessory.supportsDoorSensor) {
          accessory.updateState({ door_open: true });
          this.platform.log.info(`Device ${deviceId} door opened`);
        } else {
          this.platform.log.debug(`Device ${deviceId} door opened event ignored (door sensor not supported)`);
        }
        break;
      
      case 'device.door_closed':
        if (accessory.supportsDoorSensor) {
          accessory.updateState({ door_open: false });
          this.platform.log.info(`Device ${deviceId} door closed`);
        } else {
          this.platform.log.debug(`Device ${deviceId} door closed event ignored (door sensor not supported)`);
        }
        break;
      
      case 'device.tampered':
        this.platform.log.warn(`Device ${deviceId} tampering detected!`);
        break;
      
      case 'lock.access_denied':
        this.platform.log.warn(`Device ${deviceId} access denied`);
        break;
      
      default:
        this.platform.log.debug(`Unhandled webhook event type: ${eventType}`);
    }
  }

  /**
   * Register webhook with Seam
   */
  async registerWebhook() {
    try {
      // Check if webhook already exists for this URL
      const existingWebhooks = await this.platform.seamAPI.listWebhooks();
      const existingWebhook = existingWebhooks.find(wh => wh.url === this.webhookUrl);
      
      if (existingWebhook) {
        this.webhookId = existingWebhook.webhook_id;
        this.platform.log.info(`Using existing webhook: ${this.webhookId}`);
        this.platform.log.debug(`Webhook URL: ${this.webhookUrl}`);
        this.platform.log.debug(`Webhook secret: ${this.secret.substring(0, 8)}...`);
        return;
      }

      // Clean up any other webhooks first
      await this.cleanupWebhook();

      // Create new webhook with the provided URL
      const eventTypes = [
        'device.connected',
        'device.disconnected', 
        'lock.locked',
        'lock.unlocked',
        'device.low_battery',
        'device.battery_status_changed',
        'device.door_opened',
        'device.door_closed'
      ];
      
      this.platform.log.debug(`Registering webhook with events: ${eventTypes.join(', ')}`);
      
      let webhook;
      try {
        webhook = await this.platform.seamAPI.createWebhook(this.webhookUrl, eventTypes);
      } catch (error) {
        if (error.message.includes('Invalid event types')) {
          this.platform.log.warn('Some events not supported, trying with basic events only...');
          // Try with basic events only
          const basicEventTypes = [
            'device.connected',
            'device.disconnected', 
            'lock.locked',
            'lock.unlocked',
            'device.low_battery',
            'device.battery_status_changed'
          ];
          this.platform.log.debug(`Registering webhook with basic events: ${basicEventTypes.join(', ')}`);
          webhook = await this.platform.seamAPI.createWebhook(this.webhookUrl, basicEventTypes);
        } else {
          throw error;
        }
      }
      
      this.webhookId = webhook.webhook_id;
      this.platform.log.info(`Webhook registered with Seam: ${this.webhookId}`);
      this.platform.log.debug(`Webhook URL: ${this.webhookUrl}`);
      this.platform.log.debug(`Webhook secret: ${this.secret}`);
      
      // Save the new configuration
      this.platform.saveWebhookConfig(this.path, this.secret);
    } catch (error) {
      this.platform.log.error('Failed to register webhook:', error.message);
    }
  }

  /**
   * Clean up existing webhooks
   */
  async cleanupWebhook() {
    try {
      const existingWebhooks = await this.platform.seamAPI.listWebhooks();
      
      // Find and delete webhooks that match our base URL
      for (const webhook of existingWebhooks) {
        if (webhook.url && this.config.url && webhook.url.startsWith(this.config.url)) {
          await this.platform.seamAPI.deleteWebhook(webhook.webhook_id);
          this.platform.log.debug(`Deleted existing webhook: ${webhook.webhook_id}`);
        }
      }
    } catch (error) {
      this.platform.log.debug('Failed to cleanup webhooks:', error.message);
    }
  }

  /**
   * Stop webhook server
   */
  async stop() {
    if (this.server) {
      // Close server
      await new Promise((resolve) => {
        this.server.close(() => {
          this.platform.log.info('Webhook server stopped');
          resolve();
        });
      });

      this.server = null;
    }

    // Always clean up webhook when stopping
    await this.cleanupWebhook();
    
    // Clear saved configuration when stopping
    this.platform.saveWebhookConfig('', '');
    
    // Clear local values
    this.path = null;
    this.secret = null;
    this.webhookId = null;
  }

  /**
   * Manually delete webhook from Seam (if needed)
   */
  async deleteWebhook() {
    if (this.webhookId) {
      try {
        await this.platform.seamAPI.deleteWebhook(this.webhookId);
        this.platform.log.info(`Webhook ${this.webhookId} deleted from Seam`);
        this.webhookId = null;
        return true;
      } catch (error) {
        this.platform.log.error('Failed to delete webhook:', error.message);
        return false;
      }
    } else {
      this.platform.log.warn('No webhook ID available to delete');
      return false;
    }
  }
}

module.exports = WebhookServer;
