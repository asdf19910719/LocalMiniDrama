document.querySelector('#pause').addEventListener('click',()=>chrome.runtime.sendMessage({type:'ADAPTER_ERROR',payload:{status:'paused'}}));
