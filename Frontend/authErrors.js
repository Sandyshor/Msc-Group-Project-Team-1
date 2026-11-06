export function getAuthErrorMessage(error, action) {
  console.error(`${action} error:`, error?.code || error?.message || error)

  switch (error?.code) {
    case 'auth/invalid-email':
      return 'Enter a valid email address and try again.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'The email or password is incorrect.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try logging in instead.'
    case 'auth/weak-password':
      return 'Choose a stronger password with at least 8 characters.'
    case 'auth/operation-not-allowed':
      return 'Email and password sign-in is not enabled for this Firebase project. Enable it in Firebase Authentication settings.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'auth/network-request-failed':
      return 'Unable to reach Firebase. Check your internet connection and try again.'
    default:
      return `We couldn't ${action.toLowerCase()}. Please try again.`
  }
}
