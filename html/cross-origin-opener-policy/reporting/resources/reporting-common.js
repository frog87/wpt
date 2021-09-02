
const directory = "/html/cross-origin-opener-policy/resources";
const executor_path = directory + "/executor.html?pipe=";
const coep_header = '|header(Cross-Origin-Embedder-Policy,require-corp)';

const reportEndpoint = {
  name: "coop-report-endpoint",
  reports: []
};
const reportOnlyEndpoint = {
  name: "coop-report-only-endpoint",
  reports: []
};
const popupReportEndpoint = {
  name: "coop-popup-report-endpoint",
  reports: []
};
const popupReportOnlyEndpoint = {
  name: "coop-popup-report-only-endpoint",
  reports: []
};
const redirectReportEndpoint = {
  name: "coop-redirect-report-endpoint",
  reports: []
};
const redirectReportOnlyEndpoint = {
  name: "coop-redirect-report-only-endpoint",
  reports: []
};

const reportEndpoints = [
  reportEndpoint,
  reportOnlyEndpoint,
  popupReportEndpoint,
  popupReportOnlyEndpoint,
  redirectReportEndpoint,
  redirectReportOnlyEndpoint
];

// Allows RegExps to be pretty printed when printing unmatched expected reports.
Object.defineProperty(RegExp.prototype, "toJSON", {
  value: RegExp.prototype.toString
});

function wait(ms) {
  return new Promise(resolve => step_timeout(resolve, ms));
}

// Check whether a |report| is a "opener breakage" COOP report.
function isCoopOpenerBreakageReport(report) {
  if (report.type != "coop")
    return false;

  if (report.body.type != "navigation-from-response" &&
      report.body.type != "navigation-to-response") {
    return false;
  }

  return true;
}

async function pollReports(endpoint) {
  const res = await fetch(
    `/reporting/resources/report.py?endpoint=${endpoint.name}`,
      {cache: 'no-store'});
  if (res.status !== 200) {
    return;
  }
  for (const report of await res.json()) {
    if (isCoopOpenerBreakageReport(report))
      endpoint.reports.push(report);
  }
}

// Recursively check that all members of expectedReport are present or matched
// in report.
// Report may have members not explicitly expected by expectedReport.
function isObjectAsExpected(report, expectedReport) {
  if (( report === undefined || report === null
        || expectedReport === undefined || expectedReport === null )
      && report !== expectedReport ) {
    return false;
  }
  if (expectedReport instanceof RegExp && typeof report === "string") {
    return expectedReport.test(report);
  }
  // Perform this check now, as RegExp and strings above have different typeof.
  if (typeof report !== typeof expectedReport)
    return false;
  if (typeof expectedReport === 'object') {
    return Object.keys(expectedReport).every(key => {
      return isObjectAsExpected(report[key], expectedReport[key]);
    });
  }
  return report == expectedReport;
}

async function checkForExpectedReport(expectedReport) {
  return new Promise( async (resolve, reject) => {
    const polls = 30;
    const waitTime = 100;
    for (var i=0; i < polls; ++i) {
      pollReports(expectedReport.endpoint);
      for (var j=0; j<expectedReport.endpoint.reports.length; ++j){
        if (isObjectAsExpected(expectedReport.endpoint.reports[j],
            expectedReport.report)){
          expectedReport.endpoint.reports.splice(j,1);
          resolve();
        }
      };
      await wait(waitTime);
    }
    reject(
      replaceTokensInReceivedReport(
        "No report matched the expected report for endpoint: "
        + expectedReport.endpoint.name
        + ", expected report: " + JSON.stringify(expectedReport.report)
        + ", within available reports: "
        + JSON.stringify(expectedReport.endpoint.reports)
    ));
  });
}

function replaceFromRegexOrString(str, match, value) {
  if (str instanceof RegExp) {
    return RegExp(str.source.replace(match, value));
  }
  return str.replace(match, value);
}

// Replace generated values in regexes and strings of an expected report:
// EXECUTOR_UUID: the uuid generated with token().
function replaceValuesInExpectedReport(expectedReport, executorUuid) {
  if (expectedReport.report.body !== undefined) {
    if (expectedReport.report.body.nextResponseURL !== undefined) {
      expectedReport.report.body.nextResponseURL = replaceFromRegexOrString(
          expectedReport.report.body.nextResponseURL, "EXECUTOR_UUID",
          executorUuid);
    }
    if (expectedReport.report.body.previousResponseURL !== undefined) {
      expectedReport.report.body.previousResponseURL = replaceFromRegexOrString(
          expectedReport.report.body.previousResponseURL, "EXECUTOR_UUID",
          executorUuid);
    }
    if (expectedReport.report.body.referrer !== undefined) {
      expectedReport.report.body.referrer = replaceFromRegexOrString(
          expectedReport.report.body.referrer, "EXECUTOR_UUID",
          executorUuid);
    }
  }
  if (expectedReport.report.url !== undefined) {
      expectedReport.report.url = replaceFromRegexOrString(
          expectedReport.report.url, "EXECUTOR_UUID", executorUuid);
  }
  return expectedReport;
}

function replaceTokensInReceivedReport(str) {
  return str.replace(/.{8}-.{4}-.{4}-.{4}-.{12}/g, `(uuid)`);
}

// Run a test (such as coop_coep_test from ./common.js) then check that all
// expected reports are present.
async function reportingTest(testFunction, executorToken, expectedReports) {
  await new Promise(testFunction);
  expectedReports = Array.from(
      expectedReports,
      report => replaceValuesInExpectedReport(report, executorToken) );
  await Promise.all(Array.from(expectedReports, checkForExpectedReport));
}

function convertToWPTHeaderPipe([name, value]) {
  return `header(${name}, ${encodeURIComponent(value)})`;
}

function getReportToHeader(host) {
  return [
    "Report-To",
    reportEndpoints.map(
      reportEndpoint => {
        const reportToJSON = {
          'group': `${reportEndpoint.name}`,
          'max_age': 3600,
          'endpoints': [{
            'url': `${host}/reporting/resources/report.py?endpoint=${reportEndpoint.name}`
          }]
        };
        // Escape comma as required by wpt pipes.
        return JSON.stringify(reportToJSON)
          .replace(/,/g, '\\,')
          .replace(/\(/g, '\\\(')
          .replace(/\)/g, '\\\)=');
      }
    ).join("\\, ")];
}

function getReportingEndpointsHeader(host) {
  return [
    "Reporting-Endpoints",
    reportEndpoints.map(reportEndpoint => {
      return `${reportEndpoint.name}="${host}/reporting/resources/report.py?endpoint=${reportEndpoint.name}"`;
    }).join("\\, ")];
}

// Return Report and Report-Only policy headers.
function getPolicyHeaders(coop, coep, coopRo, coepRo) {
  return [
    [`Cross-Origin-Opener-Policy`, coop],
    [`Cross-Origin-Embedder-Policy`, coep],
    [`Cross-Origin-Opener-Policy-Report-Only`, coopRo],
    [`Cross-Origin-Embedder-Policy-Report-Only`, coepRo]];
}

function navigationReportingTest(testName, host, coop, coep, coopRo, coepRo,
  expectedReports) {
  const executorToken = token();
  const callbackToken = token();
  promise_test(async t => {
    await reportingTest(async resolve => {
      const openee_headers = [
        getReportToHeader(host.origin),
        ...getPolicyHeaders(coop, coep, coopRo, coepRo)
      ].map(convertToWPTHeaderPipe);
      const openee_url = host.origin + executor_path +
        openee_headers.join('|') + `&uuid=${executorToken}`;
      const openee = window.open(openee_url);
      const uuid = token();
      t.add_cleanup(() => send(uuid, "window.close()"));

      // 1. Make sure the new document is loaded.
      send(executorToken, `
      send("${callbackToken}", "Ready");
    `);
      let reply = await receive(callbackToken);
      assert_equals(reply, "Ready");
      resolve();
    }, executorToken, expectedReports);
  }, `coop reporting test ${testName} to ${host.name} with ${coop}, ${coep}, ${coopRo}, ${coepRo}`);
}

function navigationDocumentReportingTest(testName, host, coop, coep, coopRo,
  coepRo, expectedReports) {
  const executorToken = token();
  const callbackToken = token();
  promise_test(async t => {
    const openee_headers = [
      getReportingEndpointsHeader(host.origin),
      ...getPolicyHeaders(coop, coep, coopRo, coepRo)
    ].map(([name, value]) => convertToWPTHeaderPipe(name, value));
    const openee_url = host.origin + executor_path +
      openee_headers.join('|') + `&uuid=${executorToken}`;
    window.open(openee_url);
    t.add_cleanup(() => send(executorToken, "window.close()"));
    // Have openee window send a message through dispatcher, once we receive
    // the Ready message from dispatcher it means the openee is fully loaded.
    send(executorToken, `
      send("${callbackToken}", "Ready");
    `);
    let reply = await receive(callbackToken);
    assert_equals(reply, "Ready");

    await wait(3000);

    expectedReports = expectedReports.map(
      (report) => replaceValuesInExpectedReport(report, executorToken));
    return Promise.all(expectedReports.map(
      async ({ endpoint, report: expectedReport }) => {
        await pollReports(endpoint);
        for (let report of endpoint.reports) {
          assert_true(isObjectAsExpected(report, expectedReport),
            `report received for endpoint: ${endpoint.name} ${JSON.stringify(report)} should match ${JSON.stringify(expectedReport)}`);
        }
        assert_equals(endpoint.reports.length, 1, `has exactly one report for ${endpoint.name}`)
      }));
  }, `coop document reporting test ${testName} to ${host.name} with ${coop}, ${coep}, ${coopRo}, ${coepRo}`);
}

// Run an array of reporting tests then verify there's no reports that were not
// expected.
// Tests' elements contain: host, coop, coep, coop-report-only,
// coep-report-only, expectedReports.
// See isObjectAsExpected for explanations regarding the matching behavior.
function runNavigationReportingTests(testName, tests){
  tests.forEach( test => {
    navigationReportingTest(testName, ...test);
  });
  verifyRemainingReports();
}

// Run an array of reporting tests using Reporting-Endpoints header then
// verify there's no reports that were not expected.
// Tests' elements contain: host, coop, coep, coop-report-only,
// coep-report-only, expectedReports.
// See isObjectAsExpected for explanations regarding the matching behavior.
function runNavigationDocumentReportingTests(testName, tests) {
  tests.forEach(test => {
    navigationDocumentReportingTest(testName, ...test);
  });
}

function verifyRemainingReports() {
  promise_test(t => {
    return Promise.all(reportEndpoints.map(async (endpoint) => {
      await pollReports(endpoint);
      assert_equals(endpoint.reports.length, 0, `${endpoint.name} should be empty`);
    }));
  }, "verify remaining reports");
}
