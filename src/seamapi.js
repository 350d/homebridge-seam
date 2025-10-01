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
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'seam-api-version': '1.0.0'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';

        res.on('data', (chunk) => {
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
   * Get device information
   */
  async getDevice(deviceId) {
    try {
      const response = await this._request('POST', '/devices/get', {
        device_id: deviceId
      });
      return response.device;
    } catch (error) {
      this.log.error(`Failed to get device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * List all devices
   */
  async listDevices() {
    try {
      const response = await this._request('POST', '/devices/list', {});
      return response.devices || [];
    } catch (error) {
      this.log.error('Failed to list devices:', error.message);
      throw error;
    }
  }

  /**
   * Lock the device
   */
  async lockDoor(deviceId) {
    try {
      const response = await this._request('POST', '/locks/lock_door', {
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
      const response = await this._request('POST', '/locks/unlock_door', {
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
      
      // Convert battery level from 0-1 to 0-100 if needed
      let batteryLevel = device.properties?.battery_level || 100;
      if (batteryLevel <= 1) {
        batteryLevel = Math.round(batteryLevel * 100);
      }
      
      return {
        locked: device.properties?.locked || false,
        battery_level: batteryLevel,
        online: device.properties?.online || false,
        door_open: device.properties?.door_open || false
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
