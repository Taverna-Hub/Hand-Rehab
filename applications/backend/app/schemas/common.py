from typing import Literal

Hand = Literal["left", "right"]
Mode = Literal["buttons", "pressure"]
Sex = Literal["female", "male", "other", "not_informed"]
SessionStatus = Literal["created", "running", "finished", "cancelled", "error"]
ButtonEventType = Literal["pressed", "released"]
