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
   * Debug logging helper - checks plugin debug setting
   */
  debugLog(message, ...args) {
    if (this.platform.config.debug) {
      this.platform.log.info(`[DEBUG] ${message}`, ...args);
    }
  }

  /**
   * Generate random webhook path
   */
  generatePath() {
    return '/' + crypto.randomUUID();
  }

  /**
   * Verify Svix webhook signature.
   * Seam uses Svix for webhook delivery. Svix signs payloads with HMAC-SHA256
   * over "{svix-id}.{svix-timestamp}.{raw-body}" using the base64-decoded secret.
   */
  verifySignature(body, headers) {
    const msgId = headers['svix-id'];
    const msgTimestamp = headers['svix-timestamp'];
    const msgSignature = headers['svix-signature'];

    if (!msgId || !msgTimestamp || !msgSignature) {
      return false;
    }

    if (!this.secret) {
      this.platform.log.warn('Webhook secret not configured, cannot verify signature');
      return false;
    }

    // Reject replays older than 5 minutes
    const ts = parseInt(msgTimestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      this.platform.log.warn('Webhook rejected: timestamp out of tolerance (possible replay)');
      return false;
    }

    try {
      // Decode Svix secret — strip optional whsec_ prefix, then base64-decode
      const secretBytes = Buffer.from(
        this.secret.startsWith('whsec_') ? this.secret.slice(6) : this.secret,
        'base64'
      );

      const signedContent = `${msgId}.${msgTimestamp}.${body}`;
      const computed = crypto.createHmac('sha256', secretBytes)
        .update(signedContent, 'utf8')
        .digest('base64');

      // svix-signature may contain multiple space-delimited sigs; accept any v1 match
      const sigs = msgSignature.split(' ');
      const isValid = sigs.some(sig => {
        if (!sig.startsWith('v1,')) return false;
        const provided = sig.slice(3);
        const a = Buffer.from(computed, 'base64');
        const b = Buffer.from(provided, 'base64');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
      });

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
    this.debugLog(`Webhook server config: enabled=${this.config.enabled}, port=${this.port}, baseUrl=${this.config.url || 'not configured'}`);
    
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
      // Always generate a new random path on startup (security: rotating URL)
      // The secret is obtained from Seam's webhook creation response, not self-generated
      this.path = this.generatePath();
      this.secret = null; // will be populated after registerWebhook()
      this.debugLog(`Generated new webhook path: ${this.path}`);
      
      // Construct full URL
      this.webhookUrl = this.config.url + this.path;

      // Create HTTP server
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      // Start listening — attach error listener before listen() to catch EADDRINUSE etc.
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(this.port, () => {
          this.server.off('error', reject);
          resolve();
        });
      });

      this.platform.log.info(`Webhook server started on port ${this.port}`);
      this.debugLog(`Webhook path: ${this.path}`);

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
    this.debugLog(`Webhook request: ${req.method} ${req.url} from ${req.connection.remoteAddress}`);
    
    // Only handle POST requests to webhook path
    if (req.method !== 'POST' || req.url !== this.path) {
      this.debugLog(`Webhook request rejected: ${req.method} ${req.url} (expected POST ${this.path})`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    let body = '';
    const MAX_BODY_SIZE = 102_400; // 100 KB
    let bodyLimitExceeded = false;

    req.on('data', (chunk) => {
      if (bodyLimitExceeded) return;
      if (body.length + chunk.length > MAX_BODY_SIZE) {
        bodyLimitExceeded = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Payload Too Large' }));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });

    req.on('end', () => {
      if (bodyLimitExceeded) return;
      try {
        // Log headers for debugging
        this.debugLog('Webhook headers:', JSON.stringify(req.headers, null, 2));

        // Mandatory Svix signature verification
        if (!this.verifySignature(body, req.headers)) {
          this.platform.log.warn('Webhook rejected: invalid or missing Svix signature');
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }

        const payload = JSON.parse(body);
        this.platform.log.info(`[WEBHOOK] Received webhook: ${payload.event_type || 'unknown'} for device ${payload.device_id || 'unknown'}`);
        this.debugLog('Webhook received:', payload);

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
   * Process webhook payload with timestamp support
   */
  processWebhook(payload) {
    this.debugLog(`Processing webhook payload:`, JSON.stringify(payload, null, 2));
    
    if (!payload || !payload.event_type) {
      this.platform.log.warn('Invalid webhook payload received');
      return;
    }

    const eventType = payload.event_type;
    const deviceId = payload.device_id;
    
    // Extract timestamp from webhook - Seam provides occurred_at field
    const eventTime = payload.occurred_at ? new Date(payload.occurred_at).getTime() : Date.now();
    const eventTimeStr = payload.occurred_at || new Date(eventTime).toISOString();

    this.debugLog(`Webhook event: ${eventType} for device ${deviceId} occurred at ${eventTimeStr}`);

    // Find accessory
    const accessory = this.platform.accessories.find(acc => acc.deviceId === deviceId);
    if (!accessory) {
      this.platform.log.warn(`No accessory found for device ${deviceId}. Available accessories:`, this.platform.accessories.map(acc => acc.deviceId));
      return;
    }

    // Update accessory state based on event type
    switch (eventType) {
      case 'lock.locked':
        this.platform.log.info(`Webhook: ${deviceId} lock.locked event received at ${eventTimeStr}`);
        accessory.updateStateWithPriority({ locked: true }, 'webhook', eventTime);
        break;
      
      case 'lock.unlocked':
        this.platform.log.info(`Webhook: ${deviceId} lock.unlocked event received at ${eventTimeStr}`);
        accessory.updateStateWithPriority({ locked: false }, 'webhook', eventTime);
        break;
      
      case 'device.connected':
        accessory.updateStateWithPriority({ online: true }, 'webhook', eventTime);
        this.debugLog(`Device ${deviceId} connected`);
        break;
      
      case 'device.disconnected':
        accessory.updateStateWithPriority({ online: false }, 'webhook', eventTime);
        this.platform.log.warn(`Device ${deviceId} disconnected`);
        break;
      
      case 'device.low_battery':
        if (payload.battery_level) {
          accessory.updateStateWithPriority({ battery_level: payload.battery_level }, 'webhook', eventTime);
        }
        this.platform.log.warn(`Device ${deviceId} has low battery`);
        break;
      
      case 'device.battery_status_changed':
        if (payload.battery_level) {
          accessory.updateStateWithPriority({ battery_level: payload.battery_level }, 'webhook', eventTime);
          this.debugLog(`Device ${deviceId} battery level updated: ${Math.round(payload.battery_level * 100)}%`);
        }
        break;
      
      case 'device.door_opened':
        if (accessory.supportsDoorSensor) {
          accessory.updateStateWithPriority({ door_open: true }, 'webhook', eventTime);
          this.debugLog(`Device ${deviceId} door opened`);
        } else {
          this.debugLog(`Device ${deviceId} door opened event ignored (door sensor not supported)`);
        }
        break;
      
      case 'device.door_closed':
        if (accessory.supportsDoorSensor) {
          accessory.updateStateWithPriority({ door_open: false }, 'webhook', eventTime);
          this.debugLog(`Device ${deviceId} door closed`);
        } else {
          this.debugLog(`Device ${deviceId} door closed event ignored (door sensor not supported)`);
        }
        break;
      
      case 'device.tampered':
        this.platform.log.warn(`Device ${deviceId} tampering detected!`);
        break;
      
      case 'lock.access_denied':
        this.platform.log.warn(`Device ${deviceId} access denied`);
        break;
      
      default:
        this.debugLog(`Unhandled webhook event type: ${eventType}`);
    }
  }

  /**
   * Get supported webhook events based on device capabilities
   */
  getSupportedWebhookEvents() {
    const baseEvents = [
      'device.connected',
      'device.disconnected', 
      'lock.locked',
      'lock.unlocked',
      'device.low_battery',
      'device.battery_status_changed'
    ];
    
    // Check if any device supports door sensor
    const supportsDoorSensor = this.platform.accessories.some(accessory => 
      accessory.supportsDoorSensor === true
    );
    
    if (supportsDoorSensor) {
      baseEvents.push('device.door_opened', 'device.door_closed');
      this.debugLog('Door sensor events enabled (device supports door sensor)');
    } else {
      this.debugLog('Door sensor events disabled (no devices support door sensor)');
    }
    
    return baseEvents;
  }

  /**
   * Register webhook with Seam
   */
  async registerWebhook() {
    try {
      // Clean up any old webhooks for this base URL first
      await this.cleanupWebhook();

      const eventTypes = this.getSupportedWebhookEvents();
      this.debugLog(`Registering webhook with events: ${eventTypes.join(', ')}`);

      const webhook = await this.platform.seamAPI.createWebhook(this.webhookUrl, eventTypes);

      this.webhookId = webhook.webhook_id;
      this.secret = webhook.secret; // Svix-generated whsec_... secret
      this.platform.log.info(`Webhook registered with Seam: ${this.webhookId}`);
      this.debugLog(`Webhook URL: ${this.webhookUrl}`);

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
          try {
            await this.platform.seamAPI.deleteWebhook(webhook.webhook_id);
            this.debugLog(`Deleted existing webhook: ${webhook.webhook_id}`);
          } catch (deleteError) {
            this.debugLog(`Failed to delete webhook ${webhook.webhook_id}:`, deleteError.message);
          }
        }
      }
    } catch (error) {
      // Don't log as error during cleanup - API might be unavailable
      this.debugLog('Webhook cleanup skipped (API unavailable):', error.message);
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

}

module.exports = WebhookServer;
