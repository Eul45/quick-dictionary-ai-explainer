/* Save & restore options */

const apiKeyEl = document.getElementById('apiKey');
const modelEl = document.getElementById('model');
const autoLookupEl = document.getElementById('autoLookup');
const darkModeEl = document.getElementById('darkMode');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('saveBtn');

// Available Gemini models
const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash-lite', name: 'Flash 2.5 lite (new)' },
  
  { id: 'gemini-2.5-flash', name: 'Flash 2.5 (Newest)' },
  
  { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro (Latest)' },
  
   { id: 'gemini-2.5-pro', name: 'Pro 2.5 (Most Capable)' },
  
   { id: 'gemini-3-flash-preview', name: 'Flash 3 (Newest)' },
  
   { id: 'gemini-3-pro-preview', name: 'Pro 3.0 (paid)' }

];

// Populate model dropdown
function populateModels() {
  modelEl.innerHTML = '';
  GEMINI_MODELS.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.name;
    modelEl.appendChild(option);
  });
}

function save() {
  const settings = {
    apiKey: apiKeyEl.value.trim(),
    model: modelEl.value,
    autoLookup: autoLookupEl.checked
  };
  
  // Add dark mode if toggle exists
  if (darkModeEl) {
    settings.darkMode = darkModeEl.checked;
    // Apply dark mode immediately
    if (darkModeEl.checked) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  }
  
  browser.storage.sync.set(settings).then(() => {
    statusEl.textContent = 'Saved ✅';
    statusEl.className = 'hint ok';
    setTimeout(() => { 
      statusEl.textContent = ''; 
      statusEl.className = 'hint'; 
    }, 2000);
  }).catch((error) => {
    statusEl.textContent = 'Save failed: ' + error.message;
    statusEl.className = 'hint error';
  });
}

function restore() {
  browser.storage.sync.get({
    apiKey: '',
    model: 'gemini-2.0-flash',
    autoLookup: true,
    darkMode: true
  }).then((cfg) => {
    apiKeyEl.value = cfg.apiKey;
    modelEl.value = cfg.model;
    autoLookupEl.checked = cfg.autoLookup;
    
    // Set dark mode toggle and apply theme
    if (darkModeEl) {
      darkModeEl.checked = cfg.darkMode !== false;
    }
    
    // Apply dark mode to page
    if (cfg.darkMode !== false) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
  });
}

// Chat history elements
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const historyCount = document.getElementById('historyCount');
const chatHistoryList = document.getElementById('chatHistoryList');

// Load and display chat history
async function loadChatHistory() {
  const result = await browser.storage.local.get({ chatHistory: [] });
  const history = result.chatHistory || [];
  
  historyCount.textContent = `${history.length} conversation${history.length !== 1 ? 's' : ''}`;
  
  if (history.length === 0) {
    chatHistoryList.innerHTML = '<div class="empty-history">No conversations yet. Start by selecting text and using "Explain with AI".</div>';
    return;
  }
  
  chatHistoryList.innerHTML = '';
  history.forEach(chat => {
    const chatItem = createChatItem(chat);
    chatHistoryList.appendChild(chatItem);
  });
}

function createChatItem(chat) {
  const item = document.createElement('div');
  item.className = 'chat-item';
  
  const date = new Date(chat.timestamp).toLocaleString();
  const preview = chat.context && chat.context.length > 1 ? 
    chat.context[1].content.substring(0, 100) + '...' : 
    'No content available';
  
  const titleDiv = document.createElement('div');
  titleDiv.className = 'chat-title';
  titleDiv.textContent = chat.title;
  
  const dateDiv = document.createElement('div');
  dateDiv.className = 'chat-date';
  dateDiv.textContent = date;
  
  const previewDiv = document.createElement('div');
  previewDiv.className = 'chat-preview';
  previewDiv.textContent = preview;
  
  item.appendChild(titleDiv);
  item.appendChild(dateDiv);
  item.appendChild(previewDiv);
  
  item.addEventListener('click', () => {
    toggleChatExpansion(item, chat);
  });
  
  return item;
}

function toggleChatExpansion(item, chat) {
  const isExpanded = item.classList.contains('chat-expanded');
  
  // Close all other expanded items
  document.querySelectorAll('.chat-expanded').forEach(el => {
    el.classList.remove('chat-expanded');
    const conversation = el.querySelector('.chat-conversation');
    if (conversation) conversation.remove();
  });
  
  if (!isExpanded) {
    item.classList.add('chat-expanded');
    const conversation = document.createElement('div');
    conversation.className = 'chat-conversation';
    
    if (chat.context && chat.context.length > 0) {
      chat.context.forEach(msg => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${msg.role}`;
        
        const roleSpan = document.createElement('strong');
        roleSpan.textContent = msg.role === 'user' ? 'You:' : 'AI:';
        
        messageDiv.appendChild(roleSpan);
        messageDiv.appendChild(document.createTextNode(' ' + msg.content));
        conversation.appendChild(messageDiv);
      });
    } else {
      const noDataDiv = document.createElement('div');
      noDataDiv.className = 'chat-message';
      noDataDiv.textContent = 'No conversation data available.';
      conversation.appendChild(noDataDiv);
    }
    item.appendChild(conversation);
  }
}

async function clearAllHistory() {
  if (confirm('Are you sure you want to clear all chat history? This cannot be undone.')) {
    await browser.storage.local.set({ chatHistory: [] });
    loadChatHistory();
  }
}

// Check for hash on page load to scroll to specific section
function checkHashAndScroll() {
  if (window.location.hash === '#history') {
    setTimeout(() => {
      const historySection = document.querySelector('.chat-history-section');
      if (historySection) {
        historySection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Add a brief highlight effect
        historySection.style.backgroundColor = 'rgba(0, 123, 255, 0.1)';
        setTimeout(() => {
          historySection.style.backgroundColor = '';
        }, 1000);
      }
    }, 100);
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  populateModels();
  restore();
  loadChatHistory();
  saveBtn.addEventListener('click', save);
  clearHistoryBtn.addEventListener('click', clearAllHistory);
  checkHashAndScroll();
});
