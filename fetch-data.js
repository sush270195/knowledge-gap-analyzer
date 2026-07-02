const https = require('https');
const fs    = require('fs');

const TOKEN    = process.env.SF_ACCESS_TOKEN;
const INSTANCE = (process.env.SF_INSTANCE_URL || 'https://orgcs.my.salesforce.com').replace(/\/$/, '');
const API_VER  = process.env.SF_API_VERSION || 'v61.0';
const HOST     = INSTANCE.replace(/^https?:\/\//, '');

if (!TOKEN) {
  console.error('SF_ACCESS_TOKEN is not set.');
  process.exit(1);
}

function sfQuery(soql) {
  return new Promise(function(resolve, reject) {
    var records = [];

    function fetchPage(urlPath) {
      var options = {
        hostname: HOST,
        path:     urlPath,
        method:   'GET',
        headers:  {
          'Authorization': 'Bearer ' + TOKEN,
          'Content-Type':  'application/json'
        }
      };

      var req = https.request(options, function(res) {
        var body = '';
        res.on('data', function(c) { body += c; });
        res.on('end', function() {
          if (res.statusCode === 401) return reject(new Error('SF_ACCESS_TOKEN expired or invalid.'));
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0, 300)));
          var parsed;
          try { parsed = JSON.parse(body); } catch (e) { return reject(e); }
          records = records.concat(parsed.records || []);
          if (parsed.nextRecordsUrl) fetchPage(parsed.nextRecordsUrl);
          else resolve(records);
        });
      });
      req.on('error', reject);
      req.end();
    }

    fetchPage('/services/data/' + API_VER + '/query?q=' + encodeURIComponent(soql));
  });
}

async function main() {
  console.log('[fetch] Querying Cases...');
  const caseRecords = await sfQuery(
    'SELECT CaseNumber, Subject, Owner.Name, CaseReportingTaxonomy__r.Name, Status, CreatedDate ' +
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

  console.log('[fetch] Querying KA articles...');
  const kaRecords = await sfQuery(
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

  const output = {
    generatedAt: new Date().toISOString(),
    cases: cases,
    ka:    ka
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log('[fetch] Done — ' + cases.length + ' cases, ' + ka.length + ' KA articles written to data.json');
}

main().catch(function(e) {
  console.error('[fetch] Error:', e.message);
  process.exit(1);
});
