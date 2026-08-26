import { ChatGPTAdapter } from './adapter.js';
import { installChatGPTContentBridge } from './contentRuntime.js';

installChatGPTContentBridge({ chromeApi: chrome, adapter: new ChatGPTAdapter() });
