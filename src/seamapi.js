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
   * Poll an action attempt until it leaves pending status.
   * Seam returns pending immediately; physical lock/unlock finishes later.
   * Pass AbortSignal to cancel polling when the caller times out.
   */
  async waitForActionAttempt(actionAttempt, { timeoutMs = 30000, intervalMs = 1000, signal } = {}) {
    if (!actionAttempt?.action_attempt_id) {
      throw new Error('Missing action_attempt_id from Seam API');
    }

    let current = actionAttempt;
    const deadline = Date.now() + timeoutMs;

    while (current.status === 'pending') {
      if (signal?.aborted) {
        throw new Error(`Action attempt aborted (${current.action_type})`);
      }
      if (Date.now() >= deadline) {
        throw new Error(`Action attempt timed out after ${timeoutMs}ms (${current.action_type})`);
      }

      await new Promise((resolve, reject) => {
        let onAbort;
        const timer = setTimeout(() => {
          if (signal && onAbort) {
            signal.removeEventListener('abort', onAbort);
          }
          resolve();
        }, intervalMs);

        if (!signal) {
          return;
        }

        onAbort = () => {
          clearTimeout(timer);
          reject(new Error(`Action attempt aborted (${current.action_type})`));
        };

        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      });

      if (signal?.aborted) {
        throw new Error(`Action attempt aborted (${current.action_type})`);
      }

      const response = await this._requestWithRetry('POST', '/action_attempts/get', {
        action_attempt_id: current.action_attempt_id
      });
      current = response.action_attempt;
      if (!current) {
        throw new Error('Empty action_attempt in Seam API response');
      }
    }

    if (current.status === 'error' || current.status === 'failed') {
      const err = current.error || {};
      const detail = [err.type, err.message].filter(Boolean).join(': ') || 'unknown error';
      throw new Error(`Action attempt failed (${current.action_type}): ${detail}`);
    }

    if (current.status !== 'success') {
      throw new Error(`Unexpected action attempt status: ${current.status}`);
    }

    return current;
  }

  /**
   * Lock the device and wait until Seam confirms success/failure
   */
  async lockDoor(deviceId, options = {}) {
    try {
      const response = await this._requestWithRetry('POST', '/locks/lock_door', {
        device_id: deviceId
      });
      return await this.waitForActionAttempt(response.action_attempt, options);
    } catch (error) {
      this.log.error(`Failed to lock device ${deviceId}:`, error.message);
      throw error;
    }
  }

  /**
   * Unlock the device and wait until Seam confirms success/failure
   */
  async unlockDoor(deviceId, options = {}) {
    try {
      const response = await this._requestWithRetry('POST', '/locks/unlock_door', {
        device_id: deviceId
      });
      return await this.waitForActionAttempt(response.action_attempt, options);
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
        batteryLevel = null;
      } else if (batteryLevel > 0 && batteryLevel <= 1) {
        batteryLevel = Math.round(batteryLevel * 100);
      } else {
        batteryLevel = Math.max(0, Math.min(100, Math.round(batteryLevel)));
      }

      return {
        // null when Seam omits locked (e.g. offline) — callers keep cached state
        locked: typeof device.properties?.locked === 'boolean'
          ? device.properties.locked
          : null,
        battery_level: batteryLevel,
        online: device.properties?.online ?? false,
        door_open: typeof device.properties?.door_open === 'boolean'
          ? device.properties.door_open
          : null
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
