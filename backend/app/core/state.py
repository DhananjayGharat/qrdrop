from enum import Enum
from typing import Set, Dict

class SessionState(str, Enum):
    CREATED = "CREATED"
    QR_GENERATED = "QR_GENERATED"
    WAITING = "WAITING"
    PAIRING = "PAIRING"
    CONNECTED = "CONNECTED"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    APPROVED = "APPROVED"
    TRANSFERRING = "TRANSFERRING"
    VERIFYING = "VERIFYING"
    COMPLETED = "COMPLETED"
    
    # Terminal / Failure states
    EXPIRED = "EXPIRED"
    REJECTED = "REJECTED"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"
    DISCONNECTED = "DISCONNECTED"


# Explicit valid state transition map to enforce strict transition integrity
VALID_TRANSITIONS: Dict[SessionState, Set[SessionState]] = {
    SessionState.CREATED: {
        SessionState.QR_GENERATED,
        SessionState.CANCELLED,
        SessionState.FAILED
    },
    SessionState.QR_GENERATED: {
        SessionState.WAITING,
        SessionState.PAIRING,
        SessionState.EXPIRED,
        SessionState.CANCELLED,
        SessionState.FAILED
    },
    SessionState.WAITING: {
        SessionState.PAIRING,
        SessionState.EXPIRED,
        SessionState.CANCELLED,
        SessionState.FAILED
    },
    SessionState.PAIRING: {
        SessionState.CONNECTED,
        SessionState.REJECTED,
        SessionState.FAILED,
        SessionState.CANCELLED
    },
    SessionState.CONNECTED: {
        SessionState.AWAITING_APPROVAL,
        SessionState.DISCONNECTED,
        SessionState.CANCELLED,
        SessionState.FAILED
    },
    SessionState.AWAITING_APPROVAL: {
        SessionState.APPROVED,
        SessionState.REJECTED,
        SessionState.CANCELLED,
        SessionState.DISCONNECTED,
        SessionState.FAILED
    },
    SessionState.APPROVED: {
        SessionState.TRANSFERRING,
        SessionState.CANCELLED,
        SessionState.DISCONNECTED,
        SessionState.FAILED
    },
    SessionState.TRANSFERRING: {
        SessionState.VERIFYING,
        SessionState.CANCELLED,
        SessionState.DISCONNECTED,
        SessionState.FAILED
    },
    SessionState.VERIFYING: {
        SessionState.COMPLETED,
        SessionState.FAILED,
        SessionState.CANCELLED
    },
    # Terminal states have no forward transitions (except reconnecting from disconnected to resume)
    SessionState.DISCONNECTED: {
        SessionState.PAIRING,
        SessionState.CONNECTED,
        SessionState.TRANSFERRING,
        SessionState.FAILED
    },
    SessionState.COMPLETED: set(),
    SessionState.EXPIRED: set(),
    SessionState.REJECTED: set(),
    SessionState.CANCELLED: set(),
    SessionState.FAILED: set(),
}

class InvalidStateTransitionError(Exception):
    def __init__(self, current_state: SessionState, target_state: SessionState):
        self.current_state = current_state
        self.target_state = target_state
        super().__init__(
            f"Invalid session state transition from '{current_state.value}' to '{target_state.value}'"
        )

def validate_state_transition(current: SessionState, target: SessionState) -> bool:
    """Validates whether transitioning from current to target state is permissible."""
    if current == target:
        return True
    allowed = VALID_TRANSITIONS.get(current, set())
    if target not in allowed:
        raise InvalidStateTransitionError(current, target)
    return True
