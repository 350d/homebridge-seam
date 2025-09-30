'use strict';

const SeamPlatform = require('./src/platform');

module.exports = (api) => {
  api.registerPlatform('@350d/homebridge-seam', 'SeamLock', SeamPlatform);
};
