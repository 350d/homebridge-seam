'use strict';

const https = require('https');

/**
 * Simple wrapper for Seam API calls using native https module
 */
class SeamAPI {
  constructor(apiKey, log) {
    this.apiKey = apiKey;
    this.log = log;
    this.baseUrl = 'connect.getseam.com';
    // Keep-alive agent reuses TCP connections across requests
    this.agent = new https.Agent({ keepAlive: true, maxSockets: 5 });
  }

  /**
   * Make HTTP request to Seam API
   */
  _request(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.baseUrl,
        port: 443,
        path: path,
        method: method,
        timeout: 5000, // 5 second timeout
        agent: this.agent,
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'seam-api-version': '1.0.0'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        const MAX_RESPONSE_SIZE = 1_048_576; // 1 MB

        res.on('data', (chunk) => {
          if (body.length + chunk.length > MAX_RESPONSE_SIZE) {
            req.destroy();
            reject(new Error('Response too large'));
            return;
          }
          body += chunk;
        });

        res.on('end', () => {
          try {
            // Check if response is empty or not JSON
            if (!body || body.trim() === '') {
              reject(new Error(`Empty response from API (status: ${res.statusCode})`));
              return;
            }
            
            const response = JSON.parse(body);
            
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(response);
            } else {
              reject(new Error(`API Error ${res.statusCode}: ${response.error?.message || body}`));
            }
          } catch (e) {
            // If JSON parsing fails, check if it's an error message
            if (body.includes('error code:')) {
              reject(new Error(`API Error: ${body}`));
            } else {
              reject(new Error(`Failed to parse response: ${e.message} - Response: ${body.substring(0, 100)}...`));
            }
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (data) {
        req.write(JSON.stringify(data));
      }

      req.end();
    });
  }

  /**
   * Make HTTP request with retry and exponential backoff for transient failures
   */
  async _requestWithRetry(method, path, data = null, maxRetries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._request(method, path, data);
      } catch (error) {
        lastError = error;
        const msg = error.message || '';
        const isRetryable =
          msg.includes('Request timeout') ||
          msg.includes('ECONNRESET') ||
          msg.includes('ECONNREFUSED') ||
          msg.includes('ETIMEDOUT') ||
          msg.includes('API Error 429') ||
          msg.includes('API Error 5');

        if (!isRetryable || attempt === maxRetries) {
          throw error;
        }

        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000);
        const jitter = Math.random() * 500;
        this.log.warn(`API request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${msg}. Retrying in ${Math.round(backoffMs + jitter)}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs + jitter));
      }
    }
    throw lastError;
  }

  /**
   * Get device information
   */
  async getDevice(deviceId) {
    try {
      const response = await this._requestWithRetry('POST', '/devices/get', {
        device_id: deviceId
      });
      return response.device;
    } catch (error) {
      this.log.error(`Failed to get device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Lock the device
   */
  async lockDoor(deviceId) {
    try {
      const response = await this._requestWithRetry('POST', '/locks/lock_door', {
        device_id: deviceId
      });
      return response.action_attempt;
    } catch (error) {
      this.log.error(`Failed to lock device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Unlock the device
   */
  async unlockDoor(deviceId) {
    try {
      const response = await this._requestWithRetry('POST', '/locks/unlock_door', {
        device_id: deviceId
      });
      return response.action_attempt;
    } catch (error) {
      this.log.error(`Failed to unlock device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get device lock status
   */
  async getLockStatus(deviceId) {
    try {
      const device = await this.getDevice(deviceId);
      
      // Convert battery level from 0-1 fraction to 0-100 percentage if needed
      let batteryLevel = device.properties?.battery_level;
      if (batteryLevel == null) {
        batteryLevel = 100;
      } else if (batteryLevel > 0 && batteryLevel < 1) {
        batteryLevel = Math.round(batteryLevel * 100);
      }
      batteryLevel = Math.max(0, Math.min(100, Math.round(batteryLevel)));

      return {
        locked: typeof device.properties?.locked === 'boolean'
          ? device.properties.locked
          : true,  // Default to LOCKED when state is unknown
        battery_level: batteryLevel,
        online: device.properties?.online ?? false,
        door_open: device.properties?.door_open ?? false
      };
    } catch (error) {
      this.log.error(`Failed to get lock status for ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Create a webhook
   */
  async createWebhook(url, eventTypes = ['device.connected', 'device.disconnected', 'lock.locked', 'lock.unlocked']) {
    try {
      const response = await this._request('POST', '/webhooks/create', {
        url: url,
        event_types: eventTypes
      });
      return response.webhook;
    } catch (error) {
      this.log.error('Failed to create webhook:', error.message);
      throw error;
    }
  }

  /**
   * List all webhooks
   */
  async listWebhooks() {
    try {
      const response = await this._request('POST', '/webhooks/list', {});
      return response.webhooks || [];
    } catch (error) {
      this.log.error('Failed to list webhooks:', error.message);
      throw error;
    }
  }

  /**
   * Delete a webhook
   */
  async deleteWebhook(webhookId) {
    try {
      await this._request('POST', '/webhooks/delete', {
        webhook_id: webhookId
      });
      return true;
    } catch (error) {
      this.log.error(`Failed to delete webhook ${webhookId}:`, error.message);
      throw error;
    }
  }
}

module.exports = SeamAPI;
