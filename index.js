'use strict';

const SeamPlatform = require('./src/platform');

module.exports = (api) => {
  api.registerPlatform('SeamLock', SeamPlatform);
};
