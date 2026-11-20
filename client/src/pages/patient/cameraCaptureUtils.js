export function getCameraErrorKey(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'cameraPermissionDenied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'cameraNotFound';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'cameraBusy';
    case 'SecurityError':
      return 'cameraInsecureContext';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'cameraConstraintsUnsupported';
    default:
      return 'cameraUnavailable';
  }
}
