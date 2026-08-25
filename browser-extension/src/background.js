import { envelope } from './protocol.js';
chrome.runtime.onMessage.addListener((message,_sender,reply)=>{try{reply({ok:true,event:envelope(message.type,message.payload,message.sequence)});}catch(error){reply({ok:false,error:error.message});}return false;});
