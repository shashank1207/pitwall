import PropTypes from "prop-types";

export const TelemetryFrameShape = PropTypes.shape({
  ts: PropTypes.number,
  speed: PropTypes.number,
  rpm: PropTypes.number,
  gear: PropTypes.number,
  throttle: PropTypes.number,
  brake: PropTypes.number,
  clutch: PropTypes.number,
  steer_angle: PropTypes.number,
  lap: PropTypes.number,
  lap_time_ms: PropTypes.number,
  lap_invalid: PropTypes.bool,
  pos_x: PropTypes.number,
  pos_y: PropTypes.number,
  pos_z: PropTypes.number,
  track_position: PropTypes.number,
  wheel_pressure: PropTypes.arrayOf(PropTypes.number),
  core_temp: PropTypes.arrayOf(PropTypes.number),
  surface_temp: PropTypes.arrayOf(PropTypes.number),
});
