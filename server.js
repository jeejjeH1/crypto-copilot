require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// ── User Tracking (JSON file) ──
const fs = require('fs');
const USERS_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return {}; }
}
function saveUsers(data) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}
function trackUser(userId, name, action = 'visit') {
  const users = loadUsers();
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const dayKey = now.toISOString().slice(0, 10);
  if (!users[userId]) {
    users[userId] = { name, firstSeen: now.toISOString(), actions: {}, monthly: {}, daily: {} };
  }
  users[userId].name = name;
  users[userId].actions[action] = (users[userId].actions[action] || 0) + 1;
  if (!users[userId].monthly) users[userId].monthly = {};
  users[userId].monthly[monthKey] = (users[userId].monthly[monthKey] || 0) + 1;
  if (!users[userId].daily) users[userId].daily = {};
  users[userId].daily[dayKey] = (users[userId].daily[dayKey] || 0) + 1;
  users[userId].lastSeen = now.toISOString();
  saveUsers(users);
  return users[userId];
}
function getStats() {
  const users = loadUsers();
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const dayKey = now.toISOString().slice(0, 10);
  const totalUsers = Object.keys(users).length;
  const monthlyActive = Object.values(users).filter(u => u.monthly && u.monthly[monthKey]).length;
  const dailyActive = Object.values(users).filter(u => u.daily && u.daily[dayKey]).length;
  const todayActions = Object.values(users).reduce((s, u) => s + (u.daily?.[dayKey] || 0), 0);
  // Top users this month
  const topUsers = Object.entries(users)
    .map(([id, u]) => ({ id, name: u.name, count: u.monthly?.[monthKey] || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return { totalUsers, monthlyActive, dailyActive, todayActions, topUsers, monthKey };
}

// ── Track every API call ──
app.use((req, res, next) => {
  if (req.body?.userId) {
    trackUser(req.body.userId, req.body.userName || 'User', req.path.replace('/api/', ''));
  }
  next();
});

// ── Sorsa Score Scraper ──
app.get('/api/sorsa', async (req, res) => {
  const username = (req.query.username || '').trim().replace('@','');
  if (!username) return res.status(400).json({ error: 'Username required' });
  try {
    const r = await fetch(`https://app.sorsa.io/profile/${username}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });
    const html = await r.text();
    if (!html.includes('score_value')) return res.json({ found: false, username });
    const scoreMatch = html.match(/score_value[^0-9]*([0-9.]+)/);
    const tierMatch = html.match(/Tier\s+(\d+\.\s*\w+)/);
    const deltaMatch = html.match(/score_delta[^0-9\-]*([-0-9.]+)/);
    const botMatch = html.match(/bot_followers[^}]*value[^0-9]*([0-9.]+)/);
    const engagementMatch = html.match(/engagement_rate[^0-9]*([0-9.]+)/);
    if (!scoreMatch) return res.json({ found: false, username });
    res.json({
      found: true,
      username,
      score: Math.round(parseFloat(scoreMatch[1])),
      tier: tierMatch ? tierMatch[1] : null,
      delta: deltaMatch ? parseFloat(deltaMatch[1]) : null,
      botFollowers: botMatch ? parseFloat(botMatch[1]).toFixed(1) : null,
      engagementRate: engagementMatch ? (parseFloat(engagementMatch[1]) * 100).toFixed(1) : null,
      avatar: (() => { const m = html.match(/pbs\.twimg\.com\/profile_images\/[^"&#\\]+/); return m ? 'https://' + m[0] : null; })(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── AI (OpenRouter) ──
app.post('/api/ai', async (req, res) => {
  const { system, user, apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://x.com',
        'X-Title': 'Crypto Copilot Mini'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        temperature: 0.9,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user || '' }
        ]
      })
    });
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error?.message || JSON.stringify(data.error) });
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    res.json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Scrape & Analyze ──
app.post('/api/scrape', async (req, res) => {
  const { url, apiKey } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    const html = await r.text();
    // Strip tags to get plain text, first 5000 chars
    const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);

    const aiR = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://x.com',
        'X-Title': 'Crypto Copilot Mini'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: 'You are an expert at analyzing websites and crypto/web3 projects. Extract and summarize key information from the provided text.'
          },
          {
            role: 'user',
            content: `Analyze the following website content and extract key information about the project. Return a JSON object with: name, description, tags (array of relevant topics), and summary. Here's the content:\n\n${plainText}`
          }
        ]
      })
    });
    const data = await aiR.json();
    if (data.error) return res.status(400).json({ error: data.error?.message || JSON.stringify(data.error) });
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    // Try to parse JSON from the response
    let parsed = null;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch(e) {}
    res.json({ text, projectInfo: parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Generate Topics ──
app.post('/api/topics', async (req, res) => {
  const { projectInfo, apiKey, count = 25 } = req.body;
  if (!projectInfo) return res.status(400).json({ error: 'Project info required' });
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  try {
    const aiR = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://x.com',
        'X-Title': 'Crypto Copilot Mini'
      },
      body: JSON.stringify({
        model: 'openrouter/auto',
        temperature: 0.9,
        messages: [
          {
            role: 'system',
            content: `You are a crypto content strategist. Generate exactly ${count} diverse, engaging content topics based on the project info provided. Each topic should have 3 content ideas. Topics should cover different angles: education, news analysis, technical deep-dives, community engagement, comparisons, tutorials, opinion pieces, etc.`
          },
          {
            role: 'user',
            content: `Project info: ${typeof projectInfo === 'string' ? projectInfo : JSON.stringify(projectInfo)}\n\nGenerate exactly ${count} topics. Return ONLY a JSON array with this structure: [{topic: "topic name", ideas: [{title: "idea title", angle: "content angle"}]}]\n\nEach topic must have exactly 3 ideas. No markdown, no explanation, just the JSON array.`
          }
        ]
      })
    });
    const data = await aiR.json();
    if (data.error) return res.status(400).json({ error: data.error?.message || JSON.stringify(data.error) });
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    // Parse the JSON array from the response
    let topics = null;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) topics = JSON.parse(jsonMatch[0]);
    } catch(e) {}
    res.json({ topics, raw: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── CoinGecko prices ──
const TOP_COINS = {
  btc:'bitcoin',bitcoin:'bitcoin',eth:'ethereum',ethereum:'ethereum',ether:'ethereum',
  sol:'solana',solana:'solana',bnb:'binancecoin',xrp:'ripple',ada:'cardano',
  doge:'dogecoin',avax:'avalanche-2',dot:'polkadot',link:'chainlink',uni:'uniswap',
  aave:'aave',atom:'cosmos',ltc:'litecoin',near:'near',apt:'aptos',arb:'arbitrum',
  op:'optimism',sui:'sui',pepe:'pepe',shib:'shiba-inu',trx:'tron',fil:'filecoin',
  rndr:'render-token',fet:'fetch-ai',ondo:'ondo-finance',jup:'jupiter-exchange-solana',
  tao:'bittensor',kas:'kaspa',xlm:'stellar',algo:'algorand',hbar:'hedera-hashgraph',
  vet:'vechain',theta:'theta-token',crv:'curve-dao-token',mkr:'maker',ldo:'lido-dao',
  ens:'ethereum-name-service',stx:'blockstack',tia:'celestia',dym:'dymension',
  strk:'starknet',wif:'dogwifcoin',bonk:'bonk',floki:'floki',gala:'gala',
  sand:'the-sandbox',mana:'decentraland',chz:'chiliz',xmr:'monero',bch:'bitcoin-cash',
  etc:'ethereum-classic',eos:'eos',matic:'matic-network',polygon:'matic-network'
};

app.get('/api/prices', async (req, res) => {
  const text = (req.query.text || '').toLowerCase();
  const found = new Map();
  const tickers = text.match(/\$([a-z]{2,10})/g);
  if (tickers) for (const m of tickers) {
    const t = m.replace('$','').trim();
    if (TOP_COINS[t]) found.set(TOP_COINS[t], t);
  }
  for (const [key, id] of Object.entries(TOP_COINS)) {
    if (key.length >= 3 && !found.has(id)) {
      try { if (new RegExp('\\b'+key+'\\b','i').test(text)) found.set(id, key); } catch(e){}
    }
  }
  if (tickers) {
    for (const m of tickers.slice(0,3)) {
      const t = m.replace('$','').trim();
      if (!TOP_COINS[t] && t.length >= 3) {
        try {
          const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(t)}`);
          const d = await r.json();
          if (d.coins?.length) {
            const best = d.coins.find(c => c.symbol.toLowerCase() === t) || d.coins[0];
            found.set(best.id, best.symbol);
          }
        } catch(e){}
      }
    }
  }
  const ids = [...found.keys()].slice(0, 5);
  if (!ids.length) return res.json({ coins: [] });
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`);
    const prices = await r.json();
    const result = ids.map(id => ({
      id, name: found.get(id),
      usd: prices[id]?.usd || 0,
      change: prices[id]?.usd_24h_change || 0
    }));
    res.json({ coins: result });
  } catch(e) {
    res.json({ coins: [] });
  }
});

app.post('/api/verify', (req, res) => { res.json({ ok: true }); });

// ── Gas Fee (Etherscan) ──
app.get('/api/gas', async (req, res) => {
  try {
    const r = await fetch('https://api.etherscan.io/api?module=gastracker&action=gasoracle');
    const d = await r.json();
    if (d.status !== '1' || !d.result) return res.json({ error: 'Failed to fetch gas data' });
    res.json({
      safe: d.result.SafeGasPrice,
      propose: d.result.ProposeGasPrice,
      fast: d.result.FastGasPrice,
      baseFee: d.result.suggestBaseFee,
    });
  } catch (e) {
    // Fallback: use Blocknative or another source
    try {
      const r2 = await fetch('https://api.blocknative.com/gasprices/blockprices', {
        headers: { 'Authorization': 'public' }
      });
      const d2 = await r2.json();
      const prices = d2.blockPrices?.[0]?.estimatedPrices;
      if (prices) {
        return res.json({
          safe: prices.find(p => p.confidence === 70)?.price || '?',
          propose: prices.find(p => p.confidence === 90)?.price || '?',
          fast: prices.find(p => p.confidence === 99)?.price || '?',
          baseFee: d2.blockPrices[0]?.baseFeePerGas || '?',
        });
      }
    } catch(e2) {}
    res.json({ error: 'Gas API unavailable' });
  }
});

// ── DeFi Llama TVL ──
app.get('/api/defillama', async (req, res) => {
  try {
    const [tvlR, protocolsR, stablecoinsR] = await Promise.all([
      fetch('https://api.llama.fi/v2/historicalChainTvl'),
      fetch('https://api.llama.fi/protocols'),
      fetch('https://stablecoins.llama.fi/stablecoins?includePrices=true'),
    ]);
    const tvlData = await tvlR.json();
    const protocols = await protocolsR.json();
    const stablecoins = await stablecoinsR.json();

    // Top 10 protocols by TVL
    const topProtocols = protocols
      .sort((a, b) => (b.tvl || 0) - (a.tvl || 0))
      .slice(0, 10)
      .map(p => ({
        name: p.name,
        category: p.category,
        tvl: p.tvl,
        chain: p.chains?.[0] || 'Multi-chain',
        change_1d: p.change_1d,
        change_7d: p.change_7d,
      }));

    // Total TVL
    const totalTvl = tvlData.length ? tvlData[tvlData.length - 1].tvl : 0;
    const prevDay = tvlData.length > 1 ? tvlData[tvlData.length - 2].tvl : totalTvl;
    const tvlChange = prevDay ? ((totalTvl - prevDay) / prevDay * 100).toFixed(2) : 0;

    // Stablecoin data
    const totalStable = stablecoins.peggedAssets?.reduce((s, c) => s + (c.circulating?.peggedUSD || 0), 0) || 0;

    res.json({
      totalTvl,
      tvlChange,
      topProtocols,
      totalStablecoins: totalStable,
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ── CoinGecko Market Data ──
app.get('/api/market', async (req, res) => {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=false&price_change_percentage=1h%2C24h%2C7d');
    const data = await r.json();
    res.json({ coins: data });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ── TTS (OpenAI compatible) ──
app.post('/api/tts', async (req, res) => {
  const { text, apiKey } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  if (!apiKey) return res.status(400).json({ error: 'API key required' });
  try {
    const r = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text.substring(0, 4096),
        voice: 'alloy',
      }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(400).json({ error: err.error?.message || 'TTS failed' });
    }
    res.setHeader('Content-Type', 'audio/mpeg');
    const buf = Buffer.from(await r.arrayBuffer()); res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/tts-edge', async (req, res) => {
  const { text, voice } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  try {
    const lang = voice || 'en';
    const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(text.substring(0, 200))}`;
    const r = await fetch(ttsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    if (!r.ok) return res.status(400).json({ error: 'TTS failed' });
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', 'attachment; filename="speech.mp3"');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Stats API ──
app.get('/api/stats', (req, res) => {
  const stats = getStats();
  res.json(stats);
});

// ── Telegram Bot Webhook ──
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (BOT_TOKEN) {
  app.post('/api/webhook', async (req, res) => {
    const msg = req.body.message;
    if (!msg) return res.json({ ok: true });
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const userId = msg.from?.id;
    const userName = msg.from?.first_name || 'User';
    
    // Track user
    if (userId) trackUser(String(userId), userName, 'bot_' + (text.split(' ')[0] || 'message'));
    
    const sendMsg = async (reply) => {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: reply, parse_mode: 'HTML' }),
      });
    };
    
    if (text === '/start') {
      await sendMsg(`👋 Welcome to Crypto Copilot!\n\nI help you create crypto tweets & replies.\n\nCommands:\n/stats - Bot statistics\n/leaderboard - Top users\n/help - Help`);
    } else if (text === '/stats') {
      const s = getStats();
      let reply = `📊 <b>Bot Statistics</b>\n\n`;
      reply += `👥 Total Users: <b>${s.totalUsers}</b>\n`;
      reply += `📅 Monthly Active: <b>${s.monthlyActive}</b>\n`;
      reply += `📆 Daily Active: <b>${s.dailyActive}</b>\n`;
      reply += `⚡ Today Actions: <b>${s.todayActions}</b>\n`;
      reply += `📅 Month: ${s.monthKey}`;
      await sendMsg(reply);
    } else if (text === '/leaderboard') {
      const s = getStats();
      let reply = `🏆 <b>Top Users - ${s.monthKey}</b>\n\n`;
      if (s.topUsers.length === 0) {
        reply += 'No data yet.';
      } else {
        const medals = ['🥇', '🥈', '🥉'];
        s.topUsers.forEach((u, i) => {
          reply += `${medals[i] || (i+1+'.')} ${u.name} — ${u.count} actions\n`;
        });
      }
      await sendMsg(reply);
    } else if (text === '/help') {
      await sendMsg(`🤖 <b>Crypto Copilot Bot</b>\n\nUse the Mini App for:\n• Reply to tweets\n• Translate\n• Create tweets\n• Project research\n• Gas fees\n• Market data\n• DeFi TVL\n• Voice TTS\n\nCommands:\n/stats - Statistics\n/leaderboard - Top users`);
    }
    
    res.json({ ok: true });
  });
}

app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Crypto Copilot Mini running on port ${PORT}`));
