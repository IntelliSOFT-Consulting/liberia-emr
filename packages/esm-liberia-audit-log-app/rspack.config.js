const config = require('openmrs/default-rspack-config');

config.scriptRuleConfig.exclude = /node_modules\/(?!@openmrs\/)/;

// Disable the error overlay in the browser so we can actually see the app
if (!config.devServer) {
  config.devServer = {};
}
config.devServer.client = {
  overlay: false,
};
config.devServer.watchFiles = {
  options: {
    ignored: /node_modules/,
  },
};

module.exports = config;
