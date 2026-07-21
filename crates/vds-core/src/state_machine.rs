use std::collections::BTreeMap;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StateMachineDefinition<A, G> {
    pub initial_state: String,
    pub states: BTreeMap<String, StateDefinition<A, G>>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct StateDefinition<A, G> {
    pub entry_actions: Vec<A>,
    pub exit_actions: Vec<A>,
    pub transitions: Vec<TransitionDefinition<G>>,
    pub delayed_events: Vec<DelayedEventDefinition>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransitionDefinition<G> {
    pub event: String,
    pub target: String,
    pub guard: Option<G>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DelayedEventDefinition {
    pub event: String,
    pub delay_ns: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StateActivation<A> {
    pub state: String,
    pub entry_actions: Vec<A>,
    pub delayed_events: Vec<DelayedEventDefinition>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransitionOutcome<A> {
    pub from_state: String,
    pub to_state: String,
    pub trigger: String,
    pub exit_actions: Vec<A>,
    pub entry_actions: Vec<A>,
    pub delayed_events: Vec<DelayedEventDefinition>,
}

/// Deterministic finite-state machine with opaque action and guard payloads.
///
/// The engine owns transition selection and current-state mutation. Its caller
/// owns guard evaluation, action execution, and scheduling delayed events.
#[derive(Debug)]
pub struct StateMachine<A, G> {
    definition: StateMachineDefinition<A, G>,
    current_state: String,
}

impl<A: Clone, G> StateMachine<A, G> {
    /// Validates a definition and creates an instance in its initial state.
    ///
    /// # Errors
    ///
    /// Returns a structured error if the initial state or a transition target
    /// does not exist.
    pub fn new(definition: StateMachineDefinition<A, G>) -> Result<Self, StateMachineError> {
        if !definition.states.contains_key(&definition.initial_state) {
            return Err(StateMachineError::UnknownInitialState {
                state: definition.initial_state,
            });
        }
        for (state_name, state) in &definition.states {
            for transition in &state.transitions {
                if !definition.states.contains_key(&transition.target) {
                    return Err(StateMachineError::UnknownTransitionTarget {
                        state: state_name.clone(),
                        event: transition.event.clone(),
                        target: transition.target.clone(),
                    });
                }
            }
        }
        let current_state = definition.initial_state.clone();
        Ok(Self {
            definition,
            current_state,
        })
    }

    #[must_use]
    pub fn current_state(&self) -> &str {
        &self.current_state
    }

    /// Returns the initial/current state's entry effects without transitioning.
    ///
    /// # Errors
    ///
    /// Returns an internal definition error if the validated state disappears.
    pub fn current_activation(&self) -> Result<StateActivation<A>, StateMachineError> {
        let state = self.current_definition()?;
        Ok(StateActivation {
            state: self.current_state.clone(),
            entry_actions: state.entry_actions.clone(),
            delayed_events: state.delayed_events.clone(),
        })
    }

    /// Dispatches an event and deterministically selects the first passing
    /// transition declared for that event.
    ///
    /// # Errors
    ///
    /// Returns `InvalidEvent` when the current state has no matching event, or
    /// `GuardRejected` when matching transitions exist but no guard passes.
    pub fn dispatch<F>(
        &mut self,
        event: &str,
        mut evaluate_guard: F,
    ) -> Result<TransitionOutcome<A>, StateMachineError>
    where
        F: FnMut(&G) -> bool,
    {
        let state = self.current_definition()?;
        let mut matching_event = false;
        let selected = state.transitions.iter().find(|transition| {
            if transition.event != event {
                return false;
            }
            matching_event = true;
            transition.guard.as_ref().is_none_or(&mut evaluate_guard)
        });
        let Some(transition) = selected else {
            return Err(if matching_event {
                StateMachineError::GuardRejected {
                    state: self.current_state.clone(),
                    event: event.to_owned(),
                }
            } else {
                StateMachineError::InvalidEvent {
                    state: self.current_state.clone(),
                    event: event.to_owned(),
                }
            });
        };

        let from_state = self.current_state.clone();
        let to_state = transition.target.clone();
        let exit_actions = state.exit_actions.clone();
        let target = self.definition.states.get(&to_state).ok_or_else(|| {
            StateMachineError::InternalUnknownState {
                state: to_state.clone(),
            }
        })?;
        let outcome = TransitionOutcome {
            from_state,
            to_state: to_state.clone(),
            trigger: event.to_owned(),
            exit_actions,
            entry_actions: target.entry_actions.clone(),
            delayed_events: target.delayed_events.clone(),
        };
        self.current_state = to_state;
        Ok(outcome)
    }

    /// Returns the instance to its declared initial state.
    ///
    /// # Errors
    ///
    /// Returns an internal definition error if a validated state disappears.
    pub fn reset(&mut self) -> Result<TransitionOutcome<A>, StateMachineError> {
        let from_state = self.current_state.clone();
        let exit_actions = self.current_definition()?.exit_actions.clone();
        let to_state = self.definition.initial_state.clone();
        let target = self.definition.states.get(&to_state).ok_or_else(|| {
            StateMachineError::InternalUnknownState {
                state: to_state.clone(),
            }
        })?;
        let outcome = TransitionOutcome {
            from_state,
            to_state: to_state.clone(),
            trigger: "reset".to_owned(),
            exit_actions,
            entry_actions: target.entry_actions.clone(),
            delayed_events: target.delayed_events.clone(),
        };
        self.current_state = to_state;
        Ok(outcome)
    }

    fn current_definition(&self) -> Result<&StateDefinition<A, G>, StateMachineError> {
        self.definition
            .states
            .get(&self.current_state)
            .ok_or_else(|| StateMachineError::InternalUnknownState {
                state: self.current_state.clone(),
            })
    }
}

#[derive(Clone, Debug, Eq, PartialEq, thiserror::Error)]
pub enum StateMachineError {
    #[error("initial state '{state}' is not defined")]
    UnknownInitialState { state: String },

    #[error("state '{state}' event '{event}' targets unknown state '{target}'")]
    UnknownTransitionTarget {
        state: String,
        event: String,
        target: String,
    },

    #[error("event '{event}' is invalid in state '{state}'")]
    InvalidEvent { state: String, event: String },

    #[error("guards rejected event '{event}' in state '{state}'")]
    GuardRejected { state: String, event: String },

    #[error("state machine references missing runtime state '{state}'")]
    InternalUnknownState { state: String },
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::{
        StateDefinition, StateMachine, StateMachineDefinition, StateMachineError,
        TransitionDefinition,
    };

    fn definition(initial_state: &str, target: &str) -> StateMachineDefinition<&'static str, bool> {
        StateMachineDefinition {
            initial_state: initial_state.to_owned(),
            states: BTreeMap::from([
                (
                    "ready".to_owned(),
                    StateDefinition {
                        entry_actions: vec!["enter_ready"],
                        exit_actions: vec!["exit_ready"],
                        transitions: vec![TransitionDefinition {
                            event: "start".to_owned(),
                            target: target.to_owned(),
                            guard: Some(true),
                        }],
                        delayed_events: Vec::new(),
                    },
                ),
                (
                    "busy".to_owned(),
                    StateDefinition {
                        entry_actions: vec!["enter_busy"],
                        ..StateDefinition::default()
                    },
                ),
            ]),
        }
    }

    #[test]
    fn loads_initial_state() {
        let machine =
            StateMachine::new(definition("ready", "busy")).expect("definition should validate");

        assert_eq!(machine.current_state(), "ready");
    }

    #[test]
    fn rejects_unknown_initial_state() {
        assert!(matches!(
            StateMachine::new(definition("missing", "busy")),
            Err(StateMachineError::UnknownInitialState { .. })
        ));
    }

    #[test]
    fn rejects_unknown_transition_target() {
        assert!(matches!(
            StateMachine::new(definition("ready", "missing")),
            Err(StateMachineError::UnknownTransitionTarget { .. })
        ));
    }

    #[test]
    fn valid_transition_returns_exit_and_entry_actions() {
        let mut machine =
            StateMachine::new(definition("ready", "busy")).expect("definition should validate");

        let outcome = machine
            .dispatch("start", |guard| *guard)
            .expect("transition should succeed");

        assert_eq!(machine.current_state(), "busy");
        assert_eq!(outcome.exit_actions, ["exit_ready"]);
        assert_eq!(outcome.entry_actions, ["enter_busy"]);
    }

    #[test]
    fn rejects_invalid_event() {
        let mut machine =
            StateMachine::new(definition("ready", "busy")).expect("definition should validate");

        assert!(matches!(
            machine.dispatch("unknown", |_| true),
            Err(StateMachineError::InvalidEvent { .. })
        ));
    }

    #[test]
    fn rejects_transition_when_guard_is_false() {
        let mut machine =
            StateMachine::new(definition("ready", "busy")).expect("definition should validate");

        assert!(matches!(
            machine.dispatch("start", |_| false),
            Err(StateMachineError::GuardRejected { .. })
        ));
        assert_eq!(machine.current_state(), "ready");
    }

    #[test]
    fn reset_returns_to_initial_state() {
        let mut machine =
            StateMachine::new(definition("ready", "busy")).expect("definition should validate");
        machine
            .dispatch("start", |_| true)
            .expect("transition should succeed");

        let outcome = machine.reset().expect("reset should succeed");

        assert_eq!(machine.current_state(), "ready");
        assert_eq!(outcome.trigger, "reset");
        assert_eq!(outcome.from_state, "busy");
        assert_eq!(outcome.to_state, "ready");
    }
}
