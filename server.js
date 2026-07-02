const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const PORT       = process.env.PORT       || 3000;
const TOKEN      = process.env.SF_ACCESS_TOKEN;
const INSTANCE   = (process.env.SF_INSTANCE_URL || 'https://orgcs.my.salesforce.com').replace(/\/$/, '');
const API_VER    = process.env.SF_API_VERSION || 'v61.0';
const REFRESH_MS = 30 * 60 * 1000;

let cache       = null;
let lastFetched = null;

// ─── REST API helpers ─────────────────────────────────────────────────────────

function sfRestQuery(soql) {
  if (!TOKEN) {
    throw new Error(
      'SF_ACCESS_TOKEN env var is not set. ' +
      'Open https://orgcs.my.salesforce.com in your browser, open DevTools → Console, ' +
      'and run: copy(document.cookie) or run window.sforce.one.navigateToURL — see README for exact steps.'
    );
  }

  return new Promise(function(resolve, reject) {
    var records = [];

    function fetchPage(urlPath) {
      var options = {
        hostname: INSTANCE.replace('https://', '').replace('http://', ''),
        path:     urlPath,
        method:   'GET',
        headers:  {
          'Authorization': 'Bearer ' + TOKEN,
          'Content-Type':  'application/json'
        }
      };

      var req = https.request(options, function(res) {
        var body = '';
        res.on('data', function(chunk) { body += chunk; });
        res.on('end', function() {
          if (res.statusCode === 401) {
            return reject(new Error('SF_ACCESS_TOKEN is expired or invalid. Please refresh it.'));
          }
          if (res.statusCode !== 200) {
            return reject(new Error('SOQL HTTP ' + res.statusCode + ': ' + body.slice(0, 300)));
          }
          var parsed;
          try { parsed = JSON.parse(body); }
          catch (e) { return reject(new Error('JSON parse error: ' + e.message)); }

          records = records.concat(parsed.records || []);

          if (parsed.nextRecordsUrl) {
            fetchPage(parsed.nextRecordsUrl);
          } else {
            resolve(records);
          }
        });
      });

      req.on('error', reject);
      req.end();
    }

    var encoded = encodeURIComponent(soql);
    fetchPage('/services/data/' + API_VER + '/query?q=' + encoded);
  });
}

// ─── DATA FETCH ───────────────────────────────────────────────────────────────

async function fetchLiveData() {
  console.log('[sync] Fetching live data from OrgCS REST API...');

  const caseRecords = await sfRestQuery(
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
      owner:   r.Owner   ? r.Owner.Name : '',
      topic:   r.CaseReportingTaxonomy__r ? r.CaseReportingTaxonomy__r.Name : '',
      status:  r.Status    || '',
      created: r.CreatedDate || ''
    };
  });

  const kaRecords = await sfRestQuery(
    "SELECT ArticleNumber, Title, CreatedBy.Name, CreatedDate " +
    "FROM KnowledgeArticleVersion " +
    "WHERE PublishStatus = 'Online' " +
    "AND CreatedDate = LAST_N_DAYS:30 " +
    "ORDER BY CreatedDate DESC " +
    "LIMIT 5000"
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
    ka:    ka
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
    const data = cache;
    if (data) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } else {
      // No cache yet — fetch now
      fetchLiveData()
        .then(function(d) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(d));
        })
        .catch(function(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        });
    }
    return;
  }

  if (req.url === '/api/refresh') {
    fetchLiveData()
      .then(function(d) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, generatedAt: d.generatedAt, cases: d.cases.length, ka: d.ka.length }));
      })
      .catch(function(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      });
    return;
  }

  if (req.url === '/' || req.url === '/index.html') {
    serveStatic(res, path.join(__dirname, 'index.html'), 'text/html');
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// ─── BOOT ─────────────────────────────────────────────────────────────────────

server.listen(PORT, function() {
  console.log('[server] Listening on http://localhost:' + PORT);

  // Load data.json as initial cache (works even without SF_ACCESS_TOKEN)
  const dataPath = path.join(__dirname, 'data.json');
  if (fs.existsSync(dataPath)) {
    try {
      cache = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      console.log('[server] Loaded data.json — ' + (cache.cases||[]).length + ' cases, ' + (cache.ka||[]).length + ' KA articles');
    } catch (e) {
      console.warn('[server] Could not parse data.json:', e.message);
    }
  }

  if (!TOKEN) {
    console.warn('[server] SF_ACCESS_TOKEN not set — serving data.json only (no live sync).');
    console.warn('[server] Set it with:  SF_ACCESS_TOKEN="00D..." node server.js');
  } else {
    console.log('[server] SF_ACCESS_TOKEN found — fetching live data...');
    fetchLiveData().catch(function(e) {
      console.error('[sync] Initial fetch failed:', e.message);
    });
  }
});

setInterval(function() {
  if (!TOKEN) return;
  fetchLiveData().catch(function(e) {
    console.error('[sync] Refresh failed:', e.message);
  });
}, REFRESH_MS);
