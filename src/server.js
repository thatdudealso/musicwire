import { createApp } from './app.js';
import { config } from './config.js';

createApp().listen(config.port, () => console.log(`Musicwire listening on ${config.port}`));
