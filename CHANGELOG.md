# Changelog

## [2.10.23] - 2025-01-10

### Changed
- Reverted to original organization name (@350d/homebridge-seam)
- Restored original repository URLs
- Maintained ownership under @350d organization

## [2.10.22] - 2025-01-10

### Changed
- Prepared plugin for Homebridge Scoped Plugin migration
- Updated package name to @homebridge-plugins/homebridge-seam
- Updated repository URLs to homebridge/plugins organization
- Added funding information

## [2.10.21] - 2025-01-10

### Added
- Enhanced plugin description with supported brands
- Added August, Yale, Schlage, Kwikset to description
- Mentioned 100+ other smart lock brands support
- Expanded keywords for better discoverability

### Changed
- Updated README with detailed supported devices section
- Added specific model examples for better SEO
- Emphasized Seam's universal API support

## [2.10.20] - 2025-01-10

### Added
- Enhanced webhook and polling logging
- Added [WEBHOOK] prefix for all incoming webhook events
- Added [POLLING] prefix for lock state changes detected by polling

### Improved
- Better visibility of event sources in logs
- Helps diagnose webhook vs polling detection differences

## [2.10.19] - 2025-01-10

### Fixed
- Fixed debug logging throughout the project
- Replaced all this.log.debug with this.debugLog method
- Added debugLog method to all classes that checks plugin debug setting

### Changed
- Debug logs now only show when debug is enabled in plugin settings
- All debug logs prefixed with [DEBUG] for better visibility
- Consistent debug logging across platform, lockAccessory, and webhookServer

## [2.10.18] - 2025-01-10

### Fixed
- Fixed polling debug logging to use info level instead of debug
- Polling logs now visible when debug is enabled in plugin settings

## [2.10.17] - 2025-01-10

### Added
- Comprehensive polling debug logging
- Detailed logs for polling start/end, individual device polling
- API call timing and received status logging
- State change detection logging

## [2.10.16] - 2025-01-10

### Added
- Improved lock state change logging
- Enhanced logging for state updates, API interactions, and characteristic updates

## [2.10.15] - 2025-01-10

### Added
- Improved lock state change logging
- Enhanced logging for state updates, API interactions, and characteristic updates

## [2.10.14] - 2025-01-10

### Fixed
- Removed updateCachedAccessories method
- Device info is now correctly loaded during setup
- Fixed duplicate API calls and moved verbose logs to debug mode

## [2.10.12] - 2025-01-10

### Fixed
- Fixed cached accessories update
- Call before device setup and update all cached accessories

## [2.10.11] - 2025-01-10

### Added
- Added updateCachedAccessories method to fix device info for cached accessories

## [2.10.10] - 2025-01-10

### Improved
- Improved device info handling and polling
- Better error handling for webhook cleanup and API responses

## [2.10.9] - 2025-01-10

### Improved
- Improved error handling for webhook cleanup and API responses

## [2.10.8] - 2025-01-10

### Fixed
- Fixed device info cache update with correct field names
- Added detailed API response logging to debug device info issue

## [2.10.7] - 2025-01-10

### Added
- Added detailed logging for device info debugging

## [2.10.6] - 2025-01-10

### Fixed
- Fixed device info: load real data before creating AccessoryInformation service

## [2.10.5] - 2025-01-10

### Fixed
- Fixed device info update in HomeKit using setValue and force refresh

## [2.10.4] - 2025-01-10

### Changed
- Moved extra logs to debug level

## [2.10.2] - 2025-01-10

### Added
- Added fallback for unsupported webhook events
- Fixed webhook registration to check device capabilities first

## [2.10.1] - 2025-01-10

### Added
- Added conditional door sensor support based on device capabilities

## [2.10.0] - 2025-01-10

### Added
- Added door sensor support and additional webhook events
- Added device.battery_status_changed webhook support
- Added device.battery_status_changed to webhook registration

## [2.9.12] - 2025-01-10

### Added
- Added device.battery_status_changed to webhook registration

## [2.9.11] - 2025-01-10

### Added
- Added device.battery_status_changed webhook support

## [2.9.10] - 2025-01-10

### Removed
- Removed unused config.example.json

## [2.9.9] - 2025-01-10

### Improved
- Improved logging, webhook management, and device info

## [1.0.0] - 2025-01-10

### Added
- Initial release
- Basic smart lock support via Seam.co API
- Lock/unlock functionality
- Battery monitoring
- Webhook support for real-time updates
- HomeKit integration

---

## Legend

- **Added** for new features
- **Changed** for changes in existing functionality
- **Deprecated** for soon-to-be removed features
- **Removed** for now removed features
- **Fixed** for any bug fixes
- **Security** for vulnerability fixes
