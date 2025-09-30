'use strict';

const http = require('http');

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
    this.path = config.path || '/webhook';
  }

  /**
   * Start webhook server
   */
  async start() {
    if (!this.config.enabled) {
      this.platform.log.info('Webhook server is disabled in config');
      return;
    }

    try {
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

      this.platform.log.info(`Webhook server started on port ${this.port}, path: ${this.path}`);

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
    // Only handle POST requests to webhook path
    if (req.method !== 'POST' || req.url !== this.path) {
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
      this.platform.log.warn(`No accessory found for device ${deviceId}`);
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
      
      default:
        this.platform.log.debug(`Unhandled webhook event type: ${eventType}`);
    }
  }

  /**
   * Register webhook with Seam
   */
  async registerWebhook() {
    try {
      // Get public URL (user needs to configure port forwarding)
      // For now, we'll use a placeholder - user needs to set up ngrok or similar
      const webhookUrl = `http://YOUR_PUBLIC_IP:${this.port}${this.path}`;
      
      this.platform.log.warn('⚠️  Important: You need to configure port forwarding or use a service like ngrok');
      this.platform.log.warn(`⚠️  Webhook URL should be accessible at: ${webhookUrl}`);
      this.platform.log.warn('⚠️  Update this URL in Seam Console manually or configure public URL in code');

      // List existing webhooks
      const existingWebhooks = await this.platform.seamAPI.listWebhooks();
      
      // Check if webhook already exists
      const existingWebhook = existingWebhooks.find(wh => 
        wh.url && wh.url.includes(this.path)
      );

      if (existingWebhook) {
        this.webhookId = existingWebhook.webhook_id;
        this.platform.log.info(`Using existing webhook: ${this.webhookId}`);
      } else {
        // Note: Actual webhook registration needs public URL
        // This is commented out as it requires proper public URL setup
        /*
        const webhook = await this.platform.seamAPI.createWebhook(webhookUrl);
        this.webhookId = webhook.webhook_id;
        this.platform.log.info(`Webhook registered: ${this.webhookId}`);
        */
        this.platform.log.info('Webhook server is running, but webhook not registered with Seam yet');
        this.platform.log.info('Please register webhook manually in Seam Console with your public URL');
      }
    } catch (error) {
      this.platform.log.error('Failed to register webhook:', error.message);
    }
  }

  /**
   * Stop webhook server
   */
  async stop() {
    if (this.server) {
      // Unregister webhook from Seam
      if (this.webhookId) {
        try {
          await this.platform.seamAPI.deleteWebhook(this.webhookId);
          this.platform.log.info('Webhook unregistered from Seam');
        } catch (error) {
          this.platform.log.error('Failed to unregister webhook:', error.message);
        }
      }

      // Close server
      await new Promise((resolve) => {
        this.server.close(() => {
          this.platform.log.info('Webhook server stopped');
          resolve();
        });
      });

      this.server = null;
      this.webhookId = null;
    }
  }
}

module.exports = WebhookServer;
