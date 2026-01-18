/* Popup logic */

// Simple markdown renderer for AI responses with HTML escaping
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdownSafe(text, container) {
  if (!text) return;
  
  container.textContent = '';
  
  // Split text by lines and process each
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (line.trim() === '') {
      container.appendChild(document.createElement('br'));
      continue;
    }
    
    const p = document.createElement('p');
    p.style.margin = '0';
    p.style.padding = '0';
    
    // Process inline formatting
    let processedText = line;
    const elements = [];
    
    // Handle bold **text**
    processedText = processedText.replace(/\*\*(.*?)\*\*/g, (match, content) => {
      const strong = document.createElement('strong');
      strong.textContent = content;
      elements.push(strong);
      return `__ELEMENT_${elements.length - 1}__`;
    });
    
    // Handle italic *text*
    processedText = processedText.replace(/\*(.*?)\*/g, (match, content) => {
      const em = document.createElement('em');
      em.textContent = content;
      elements.push(em);
      return `__ELEMENT_${elements.length - 1}__`;
    });
    
    // Handle code `text`
    processedText = processedText.replace(/`(.*?)`/g, (match, content) => {
      const code = document.createElement('code');
      code.textContent = content;
      code.style.backgroundColor = '#f0f0f0';
      code.style.padding = '2px 4px';
      code.style.borderRadius = '3px';
      elements.push(code);
      return `__ELEMENT_${elements.length - 1}__`;
    });
    
    // Split by element placeholders and add text/elements
    const parts = processedText.split(/(__ELEMENT_\d+__)/);
    for (const part of parts) {
      if (part.startsWith('__ELEMENT_')) {
        const index = parseInt(part.match(/\d+/)[0]);
        p.appendChild(elements[index]);
      } else if (part) {
        p.appendChild(document.createTextNode(part));
      }
    }
    
    container.appendChild(p);
  }
}

// Dark mode handler
const darkModeToggle = document.createElement("a");
darkModeToggle.href = "#";
darkModeToggle.textContent = "🌙";
darkModeToggle.style.textDecoration = "none";
darkModeToggle.style.fontSize = "18px";
darkModeToggle.title = "Toggle Dark Mode";
darkModeToggle.onclick = () => {
  document.body.classList.toggle("dark-mode");
  browser.storage.sync.set({darkMode: document.body.classList.contains("dark-mode")});
};
const headerRow = document.querySelector(".row");
if (headerRow) {
  headerRow.appendChild(darkModeToggle);
}

// Initialize dark mode on load
browser.storage.sync.get({darkMode: true}).then(data => {
  if (data.darkMode !== false) {
    document.body.classList.add("dark-mode");
  }
});
const wordInput = document.getElementById('word');
const btnLookup = document.getElementById('btnLookup');
const btnExplain = document.getElementById('btnExplain');
const btnFollowUp = document.getElementById('btnFollowUp');
const result = document.getElementById('result');
const autoLookup = document.getElementById('autoLookup');
const openOptions = document.getElementById('openOptions');
const openHistory = document.getElementById('openHistory');

// Follow-up elements
const followupSection = document.getElementById('followupSection');
const followupInput = document.getElementById('followupInput');
const sendFollowup = document.getElementById('sendFollowup');
const cancelFollowup = document.getElementById('cancelFollowup');

// Conversation state
let currentChatId = null;
let conversationContext = [];

openOptions.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

openHistory.addEventListener('click', () => {
  // Open options page with hash to go directly to Chat History section
  browser.tabs.create({ url: browser.runtime.getURL('options.html#history') });
});

/* Restore auto-lookup preference */
browser.storage.sync.get({ autoLookup: true }).then((data) => {
  autoLookup.checked = data.autoLookup;
});

autoLookup.addEventListener('change', (e) => {
  browser.storage.sync.set({ autoLookup: e.target.checked });
});

btnLookup.addEventListener('click', async () => {
  const text = wordInput.value.trim();
  if (!text) { return; }
  result.textContent = "Looking up definition...";
  try {
    const res = await sendMessageWithRetry({ type: 'DICT_LOOKUP', payload: { text } });
    console.log('Dictionary lookup response:', res);
    if (res?.ok) {
      result.textContent = res.definition || "No definition found.";
    } else {
      result.textContent = res?.error || "Lookup failed.";
    }
  } catch (error) {
    console.error('Dictionary lookup error:', error);
    result.textContent = `Connection error: ${error.message}`;
  }
});

btnExplain.addEventListener('click', async () => {
  const text = wordInput.value.trim();
  if (!text) { return; }
  result.textContent = "Asking AI to explain...";
  
  // Get page context if enabled
  let pageContext = null;
  const config = await browser.storage.sync.get({ includePageContext: false });
  if (config.includePageContext) {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]?.id) {
        const response = await browser.tabs.sendMessage(tabs[0].id, { type: 'GET_PAGE_CONTENT' });
        if (response?.pageInfo) {
          pageContext = response.pageInfo;
        }
      }
    } catch (error) {
      console.log('Could not get page context:', error);
    }
  }
  
  try {
    const res = await sendMessageWithRetry({ 
      type: 'AI_EXPLAIN', 
      payload: { 
        text,
        isNewConversation: true,
        pageContext: pageContext
      } 
    });
    if (res?.ok) {
      if (res.explanation) {
        renderMarkdownSafe(res.explanation, result);
      } else {
        result.textContent = "No explanation.";
      }
      currentChatId = res.chatId;
      conversationContext = res.context || [];
      btnFollowUp.style.display = 'inline-block';
    } else {
      result.textContent = res?.error || "AI request failed.";
    }
  } catch (error) {
    result.textContent = "Connection error. Please try again.";
  }
});

// Follow-up button handlers
btnFollowUp.addEventListener('click', () => {
  followupSection.style.display = 'block';
  followupInput.focus();
});

cancelFollowup.addEventListener('click', () => {
  followupSection.style.display = 'none';
  followupInput.value = '';
});

sendFollowup.addEventListener('click', async () => {
  const followUpQuestion = followupInput.value.trim();
  if (!followUpQuestion) return;
  
  followupSection.style.display = 'none';
  result.textContent = 'Asking follow-up...';
  
  try {
    const res = await sendMessageWithRetry({ 
      type: 'AI_FOLLOWUP', 
      payload: { 
        question: followUpQuestion,
        chatId: currentChatId,
        context: conversationContext
      } 
    });
    if (res?.ok) {
      if (res.explanation) {
        renderMarkdownSafe(res.explanation, result);
      } else {
        result.textContent = "No explanation.";
      }
      conversationContext = res.context || conversationContext;
    } else {
      result.textContent = res?.error || 'Follow-up failed.';
    }
  } catch (error) {
    result.textContent = 'Connection error. Please try again.';
  }
  followupInput.value = '';
});

// Allow Enter key to send follow-up
followupInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendFollowup.click();
  }
});

/* Helper function to send messages with retry logic */
async function sendMessageWithRetry(message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log('Sending message:', message);
      const response = await browser.runtime.sendMessage(message);
      console.log('Received response:', response);
      
      if (!response) {
        throw new Error('No response from background script');
      }
      
      return response;
    } catch (error) {
      console.error(`Message attempt ${i + 1} failed:`, error);
      if (i === maxRetries - 1) {
        throw error;
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 200 * (i + 1)));
    }
  }
}

// Initialize everything when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Initialize dark mode first
  browser.storage.sync.get({darkMode: true}).then(data => {
    if (data.darkMode !== false) {
      document.body.classList.add("dark-mode");
    }
  });
  
  // Test background script connection
  browser.runtime.sendMessage({type: 'PING'}).then(response => {
    console.log('Background script connection test:', response);
  }).catch(error => {
    console.error('Background script not responding:', error);
  });
  
  // Autofill selected text from active tab
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (!tabs[0]) return;
    browser.tabs.sendMessage(tabs[0].id, { type: 'GET_SELECTION' }).then((response) => {
      if (response?.selection) {
        wordInput.value = response.selection.slice(0, 200);
      }
    }).catch(() => {
      // Ignore connection errors for selection
    });
  });
});
