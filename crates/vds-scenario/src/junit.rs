//! JUnit XML export for scenario results.

use std::fmt::Write;

use crate::{ResultStatus, ScenarioResult, StepFailureKind, StepResult};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct JUnitReportMetadata<'a> {
    pub run_id: &'a str,
    pub scenario_revision: u64,
}

#[must_use]
pub fn to_junit_xml(result: &ScenarioResult, metadata: JUnitReportMetadata<'_>) -> String {
    let failures = result
        .steps
        .iter()
        .filter(|step| {
            step.status == ResultStatus::Failed && report_kind(step) == StepFailureKind::Assertion
        })
        .count();
    let errors = result
        .steps
        .iter()
        .filter(|step| {
            step.status == ResultStatus::Failed && report_kind(step) == StepFailureKind::Execution
        })
        .count();
    let scenario_id = xml_escape(&result.scenario_id);
    let run_id = xml_escape(metadata.run_id);
    let mut xml = String::new();
    writeln!(xml, "<?xml version=\"1.0\" encoding=\"UTF-8\"?>")
        .expect("writing to String cannot fail");
    writeln!(
        xml,
        "<testsuite name=\"{scenario_id}\" tests=\"{}\" failures=\"{failures}\" errors=\"{errors}\" skipped=\"{}\" time=\"{}\">",
        result.steps.len(),
        result.steps_skipped,
        seconds(result.duration_virtual_ns),
    )
    .expect("writing to String cannot fail");
    writeln!(xml, "  <properties>").expect("writing to String cannot fail");
    writeln!(
        xml,
        "    <property name=\"vds4e.scenario_id\" value=\"{scenario_id}\"/>"
    )
    .expect("writing to String cannot fail");
    writeln!(
        xml,
        "    <property name=\"vds4e.run_id\" value=\"{run_id}\"/>"
    )
    .expect("writing to String cannot fail");
    writeln!(
        xml,
        "    <property name=\"vds4e.scenario_revision\" value=\"{}\"/>",
        metadata.scenario_revision
    )
    .expect("writing to String cannot fail");
    writeln!(
        xml,
        "    <property name=\"vds4e.virtual_duration_ns\" value=\"{}\"/>",
        result.duration_virtual_ns
    )
    .expect("writing to String cannot fail");
    writeln!(xml, "  </properties>").expect("writing to String cannot fail");
    for step in &result.steps {
        write_testcase(&mut xml, &scenario_id, step);
    }
    writeln!(xml, "</testsuite>").expect("writing to String cannot fail");
    xml
}

fn write_testcase(xml: &mut String, scenario_id: &str, step: &StepResult) {
    let step_id = xml_escape(&step.step_id);
    let action = xml_escape(&step.action);
    let duration = step
        .completed_virtual_ns
        .saturating_sub(step.started_virtual_ns);
    match step.status {
        ResultStatus::Passed => {
            writeln!(
                xml,
                "  <testcase classname=\"{scenario_id}\" name=\"{step_id}\" time=\"{}\"/>",
                seconds(duration)
            )
            .expect("writing to String cannot fail");
        }
        ResultStatus::Skipped => {
            writeln!(
                xml,
                "  <testcase classname=\"{scenario_id}\" name=\"{step_id}\" time=\"{}\">",
                seconds(duration)
            )
            .expect("writing to String cannot fail");
            writeln!(xml, "    <skipped/>").expect("writing to String cannot fail");
            writeln!(xml, "  </testcase>").expect("writing to String cannot fail");
        }
        ResultStatus::Failed => {
            writeln!(
                xml,
                "  <testcase classname=\"{scenario_id}\" name=\"{step_id}\" time=\"{}\">",
                seconds(duration)
            )
            .expect("writing to String cannot fail");
            match report_kind(step) {
                StepFailureKind::Assertion => {
                    writeln!(xml, "    <failure type=\"assertion\" message=\"{action} assertion failed\">Step {step_id} did not satisfy {action}.</failure>").expect("writing to String cannot fail");
                }
                StepFailureKind::Execution => {
                    writeln!(xml, "    <error type=\"execution\" message=\"{action} execution failed\">Step {step_id} could not complete {action}.</error>").expect("writing to String cannot fail");
                }
            }
            writeln!(xml, "  </testcase>").expect("writing to String cannot fail");
        }
    }
}

fn report_kind(step: &StepResult) -> StepFailureKind {
    step.failure_kind.unwrap_or(StepFailureKind::Execution)
}

fn seconds(nanoseconds: u64) -> String {
    format!(
        "{}.{:09}",
        nanoseconds / 1_000_000_000,
        nanoseconds % 1_000_000_000
    )
}

fn xml_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        let character = if is_xml_character(character) {
            character
        } else {
            '\u{fffd}'
        };
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            other => escaped.push(other),
        }
    }
    escaped
}

fn is_xml_character(character: char) -> bool {
    matches!(character, '\u{9}' | '\u{a}' | '\u{d}')
        || ('\u{20}'..='\u{d7ff}').contains(&character)
        || ('\u{e000}'..='\u{fffd}').contains(&character)
        || ('\u{10000}'..='\u{10ffff}').contains(&character)
}

#[cfg(test)]
mod tests {
    use super::{JUnitReportMetadata, to_junit_xml};
    use crate::{ResultStatus, ScenarioResult, StepFailureKind, StepResult};

    fn result(steps: Vec<StepResult>) -> ScenarioResult {
        let passed = steps
            .iter()
            .filter(|step| step.status == ResultStatus::Passed)
            .count();
        let failed = steps
            .iter()
            .filter(|step| step.status == ResultStatus::Failed)
            .count();
        let skipped = steps
            .iter()
            .filter(|step| step.status == ResultStatus::Skipped)
            .count();
        ScenarioResult {
            scenario_id: "scenario<&\"'\u{1}".to_owned(),
            status: if failed == 0 {
                ResultStatus::Passed
            } else {
                ResultStatus::Failed
            },
            started_virtual_ns: 1_000_000_000,
            completed_virtual_ns: 2_234_567_890,
            duration_virtual_ns: 1_234_567_890,
            steps_total: steps.len(),
            steps_passed: passed,
            steps_failed: failed,
            steps_skipped: skipped,
            steps,
        }
    }

    fn step(id: &str, status: ResultStatus, failure_kind: Option<StepFailureKind>) -> StepResult {
        StepResult {
            step_id: id.to_owned(),
            action: if failure_kind == Some(StepFailureKind::Assertion) {
                "assert_response"
            } else {
                "advance_time"
            }
            .to_owned(),
            status,
            started_virtual_ns: 1_000_000_000,
            completed_virtual_ns: 1_250_000_001,
            error: failure_kind.map(|_| "sensitive raw payload EF 40 18 /internal/path".to_owned()),
            failure_kind,
        }
    }

    #[test]
    fn maps_pass_failure_error_and_skipped_with_deterministic_durations() {
        let report = result(vec![
            step("pass", ResultStatus::Passed, None),
            step(
                "assert<&",
                ResultStatus::Failed,
                Some(StepFailureKind::Assertion),
            ),
            step(
                "runtime",
                ResultStatus::Failed,
                Some(StepFailureKind::Execution),
            ),
            step("skip", ResultStatus::Skipped, None),
        ]);
        let metadata = JUnitReportMetadata {
            run_id: "run<&",
            scenario_revision: 7,
        };
        let xml = to_junit_xml(&report, metadata);
        assert_eq!(xml, to_junit_xml(&report, metadata));
        assert!(xml.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"));
        assert!(xml.contains(
            "tests=\"4\" failures=\"1\" errors=\"1\" skipped=\"1\" time=\"1.234567890\""
        ));
        assert!(xml.contains("<testcase classname=\"scenario&lt;&amp;&quot;&apos;�\" name=\"pass\" time=\"0.250000001\"/>"));
        assert!(xml.contains("<failure type=\"assertion\""));
        assert!(xml.contains("<error type=\"execution\""));
        assert!(xml.contains("<skipped/>"));
        assert!(xml.contains("name=\"vds4e.run_id\" value=\"run&lt;&amp;\""));
        assert!(xml.contains("name=\"vds4e.scenario_revision\" value=\"7\""));
        assert!(!xml.contains("EF 40 18"));
        assert!(!xml.contains("/internal/path"));
    }

    #[test]
    fn preserves_the_existing_json_result_shape() {
        let report = result(vec![step(
            "failed",
            ResultStatus::Failed,
            Some(StepFailureKind::Assertion),
        )]);
        let json = report.to_json_pretty().expect("JSON should serialize");
        assert!(!json.contains("failure_kind"));
        assert!(json.contains("\"error\": \"sensitive raw payload"));
    }
}
