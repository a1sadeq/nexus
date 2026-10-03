import React from 'react'
import ReactDOM from 'react-dom/client'


window.onerror = function(msg, _url, _lineNo, _columnNo, error) {
  const div = document.createElement('div');
  div.style = 'position:fixed;top:0;left:0;z-index:999999;background:red;color:white;padding:20px;font-size:20px;';
  div.innerText = msg + '\n' + (error ? error.stack : '');
  document.body.appendChild(div);
};

import App from './App'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
