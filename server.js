const http = require('http');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const REFRESH_MS = 30 * 60 * 1000; // 30 minutes

let cache = null;
let lastFetched = null;

// ─── SOQL helpers ────────────────────────────────────────────────────────────

function sfQuery(soql) {
  const result = execFileSync(
    'sf',
    ['data', 'query', '--query', soql, '--json'],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
  );
  const parsed = JSON.parse(result);
  if (parsed.status !== 0) throw new Error('SOQL failed: ' + JSON.stringify(parsed));
  return parsed.result.records || [];
}

// ─── DATA FETCH ───────────────────────────────────────────────────────────────

function fetchLiveData() {
  console.log('[sync] Fetching live data from OrgCS...');

  // Cases: last 30 days, scoped to active owners with taxonomy
  const caseRecords = sfQuery(
    'SELECT CaseNumber, Subject, Owner.Name, CaseReportingTaxonomy__r.Name, Status, Priority, CreatedDate ' +
    'FROM Case ' +
    'WHERE CreatedDate = LAST_N_DAYS:30 ' +
    'AND CaseReportingTaxonomy__c != null ' +
    'AND Owner.IsActive = true ' +
    'ORDER BY CreatedDate DESC ' +
    'LIMIT 50000'
  );

  const cases = caseRecords.map(function(r) {
    return {
      num:     r.CaseNumber,
      subject: r.Subject || '',
      owner:   r.Owner ? r.Owner.Name : '',
      topic:   r.CaseReportingTaxonomy__r ? r.CaseReportingTaxonomy__r.Name : '',
      status:  r.Status || '',
      created: r.CreatedDate || ''
    };
  });

  // KA articles created in last 30 days
  const kaRecords = sfQuery(
    'SELECT ArticleNumber, Title, CreatedBy.Name, CreatedDate ' +
    'FROM KnowledgeArticleVersion ' +
    'WHERE PublishStatus = \'Online\' ' +
    'AND CreatedDate = LAST_N_DAYS:30 ' +
    'ORDER BY CreatedDate DESC ' +
    'LIMIT 5000'
  );

  const ka = kaRecords.map(function(r) {
    return {
      num:    r.ArticleNumber,
      title:  r.Title || '',
      author: r.CreatedBy ? r.CreatedBy.Name : '',
      date:   r.CreatedDate || ''
    };
  });

  cache = {
    generatedAt: new Date().toISOString(),
    cases: cases,
    ka: ka
  };
  lastFetched = Date.now();

  console.log('[sync] Done — ' + cases.length + ' cases, ' + ka.length + ' KA articles');
  return cache;
}

// ─── STATIC FILE SERVE ────────────────────────────────────────────────────────

function serveStatic(res, filePath, contentType) {
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (e) {
    res.writeHead(404); res.end('Not found');
  }
}

// ─── SERVER ───────────────────────────────────────────────────────────────────

const server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/api/data') {
    const data = cache || fetchLiveData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  if (req.url === '/api/refresh') {
    try {
      const data = fetchLiveData();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, generatedAt: data.generatedAt, cases: data.cases.length, ka: data.ka.length }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    serveStatic(res, path.join(__dirname, 'index.html'), 'text/html');
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// ─── BOOT ─────────────────────────────────────────────────────────────────────

try {
  fetchLiveData();
} catch (e) {
  console.error('[sync] Initial fetch failed:', e.message);
  cache = { generatedAt: new Date().toISOString(), cases: [], ka: [], error: e.message };
}

setInterval(function() {
  try { fetchLiveData(); }
  catch (e) { console.error('[sync] Refresh failed:', e.message); }
}, REFRESH_MS);

server.listen(PORT, function() {
  console.log('[server] Listening on http://localhost:' + PORT);
  console.log('[server] Live data syncs every 30 minutes');
});
