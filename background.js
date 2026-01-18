/* Background script */

// Available Gemini models - first one is the default
const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash-lite', name: 'Flash 2.5 lite (new)' },
  { id: 'gemini-2.5-flash', name: 'Flash 2.5 (Newest)' },
  { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro (Latest)' },
  { id: 'gemini-2.5-pro', name: 'Pro 2.5 (Most Capable)' },
  { id: 'gemini-3-flash-preview', name: 'Flash 3 (Newest)' },
  { id: 'gemini-3-pro-preview', name: 'Pro 3.0 (paid)' }
];
const DEFAULT_MODEL = GEMINI_MODELS[0].id;

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "aiExplainSelection",
    title: "Explain with AI",
    contexts: ["selection"]
  });
  
  // Set dark mode and auto-lookup as default for new installations
  browser.storage.sync.get({ darkMode: null, autoLookup: null }).then((data) => {
    const updates = {};
    if (data.darkMode === null) {
      updates.darkMode = true;
    }
    if (data.autoLookup === null) {
      updates.autoLookup = true;
    }
    if (Object.keys(updates).length > 0) {
      browser.storage.sync.set(updates);
    }
  });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "aiExplainSelection" && info.selectionText) {
    // Get page context if enabled
    let pageContext = null;
    const cfg = await getConfig();
    if (cfg.includePageContext && tab?.id) {
      try {
        const response = await browser.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTENT' });
        if (response?.pageInfo) {
          pageContext = response.pageInfo;
        }
      } catch (error) {
        console.log('Could not get page context:', error);
      }
    }
    
    const result = await explainWithAI(info.selectionText, false, pageContext).catch(e => ({ explanation: `Error: ${e.message}` }));
    const explanation = result.explanation || result;
    if (tab?.id) {
      browser.tabs.sendMessage(tab.id, { type: 'SHOW_TOOLTIP', payload: { text: explanation } });
    }
  }
});

/* Message routing */
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'PING') {
        sendResponse({ ok: true, message: 'Background script is running' });
      } else if (message.type === 'DICT_LOOKUP') {
        console.log('Dictionary lookup request:', message.payload.text);
        const def = await dictionaryLookup(message.payload.text);
        console.log('Dictionary lookup result:', def);
        sendResponse({ ok: true, definition: def });
      } else if (message.type === 'AI_EXPLAIN') {
        const result = await explainWithAI(
          message.payload.text, 
          message.payload.isNewConversation,
          message.payload.pageContext
        );
        if (result.explanation) {
          sendResponse({ ok: true, explanation: result.explanation, chatId: result.chatId, context: result.context });
        } else {
          sendResponse({ ok: true, explanation: result });
        }
      } else if (message.type === 'AI_FOLLOWUP') {
        const result = await followUpWithAI(message.payload.question, message.payload.chatId, message.payload.context);
        sendResponse({ ok: true, explanation: result.explanation, context: result.context });
      } else {
        sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e?.message || String(e) });
    }
  })();
  return true; // keep port open for async
});

/* Dictionary lookup via Free Dictionary API */
async function dictionaryLookup(text) {
  const word = text.trim().split(/\s+/)[0]; // first token
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Dictionary API error');
  }
  const data = await res.json();
  // Build a simple, readable definition string
  const parts = [];
  if (Array.isArray(data)) {
    const entry = data[0];
    if (entry?.word) parts.push(`• ${entry.word}`);
    if (entry?.phonetics?.[0]?.text) parts.push(`  ${entry.phonetics[0].text}`);
    const meanings = entry?.meanings || [];
    meanings.slice(0, 3).forEach((m, idx) => {
      parts.push(`\n${idx+1}. (${m.partOfSpeech})`);
      (m.definitions || []).slice(0, 2).forEach((d, j) => {
        parts.push(`   - ${d.definition}`);
        if (d.example) parts.push(`     e.g., ${d.example}`);
      });
    });
  } else if (data?.title) {
    parts.push(data.title);
  } else {
    parts.push('No definition found.');
  }
  return parts.join('\n');
}

/* AI explanation using Google's Gemini API */
async function explainWithAI(text, isNewConversation = false, pageContext = null) {
  const cfg = await getConfig();
  if (!cfg.apiKey) {
    throw new Error('Add your Gemini API key in Options.');
  }
  
  const model = cfg.model || DEFAULT_MODEL;
  const chatId = isNewConversation ? generateChatId() : null;
  
  // Build prompt with optional page context
  let prompt = '';
  if (pageContext && cfg.includePageContext) {
    // Include page context if enabled
    prompt = `You are analyzing text from a webpage. Here's the context:\n\n` +
             `Page Title: ${pageContext.title || 'Unknown'}\n` +
             `Page URL: ${pageContext.url || 'Unknown'}\n` +
             `Page Content (excerpt): ${pageContext.content.substring(0, 2000) || 'N/A'}\n\n` +
             `The user has selected this text: "${text}"\n\n` +
             `Please explain what this selected text means in the context of this page. ` +
             `Focus on how it relates to the page content. Keep it under 150 words.`;
  } else {
    // Original prompt without context
    prompt = `Explain the following in simple, beginner-friendly terms. Keep it under 120 words:\n\n"${text}"`;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 200,
        topP: 0.8,
        topK: 40
      }
    })
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Gemini API error: ${res.status} - ${error.error?.message || 'Unknown error'}`);
  }
  
  const data = await res.json();
  const explanation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'No explanation available.';
  
  if (isNewConversation && chatId) {
    const context = [
      { role: 'user', content: `Explain: ${text}` },
      { role: 'assistant', content: explanation }
    ];
    await saveChatHistory(chatId, text, context);
    return { explanation, chatId, context };
  }
  
  return { explanation };
}

/* Follow-up AI conversation with context */
async function followUpWithAI(question, chatId, context) {
  const cfg = await getConfig();
  if (!cfg.apiKey) {
    throw new Error('Add your Gemini API key in Options.');
  }
  
  const model = cfg.model || DEFAULT_MODEL;
  
  // Build conversation history for context
  let conversationText = '';
  if (context && context.length > 0) {
    conversationText = context.map(msg => `${msg.role}: ${msg.content}`).join('\n') + '\n';
  }
  
  const prompt = `${conversationText}user: ${question}\n\nPlease answer the follow-up question based on our previous conversation. Keep it under 120 words.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.apiKey}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 200,
        topP: 0.8,
        topK: 40
      }
    })
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(`Gemini API error: ${res.status} - ${error.error?.message || 'Unknown error'}`);
  }
  
  const data = await res.json();
  const explanation = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'No explanation available.';
  
  // Update context with new exchange
  const updatedContext = [...context, 
    { role: 'user', content: question },
    { role: 'assistant', content: explanation }
  ];
  
  if (chatId) {
    await updateChatHistory(chatId, updatedContext);
  }
  
  return { explanation, context: updatedContext };
}

/* Chat history management */
function generateChatId() {
  return 'chat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function saveChatHistory(chatId, originalText, context) {
  const chatData = {
    id: chatId,
    originalText,
    context,
    timestamp: Date.now(),
    title: originalText.substring(0, 50) + (originalText.length > 50 ? '...' : '')
  };
  
  const result = await browser.storage.local.get({ chatHistory: [] });
  const history = result.chatHistory || [];
  history.unshift(chatData); // Add to beginning
  
  // Keep only last 50 conversations
  if (history.length > 50) {
    history.splice(50);
  }
  
  await browser.storage.local.set({ chatHistory: history });
}

async function updateChatHistory(chatId, updatedContext) {
  const result = await browser.storage.local.get({ chatHistory: [] });
  const history = result.chatHistory || [];
  
  const chatIndex = history.findIndex(chat => chat.id === chatId);
  if (chatIndex !== -1) {
    history[chatIndex].context = updatedContext;
    history[chatIndex].timestamp = Date.now(); // Update timestamp
    await browser.storage.local.set({ chatHistory: history });
  }
}

function getConfig() {
  return browser.storage.sync.get({
    apiKey: '',
    model: DEFAULT_MODEL,
    autoLookup: true,
    darkMode: true,
    includePageContext: false
  });
}
