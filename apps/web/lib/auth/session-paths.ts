/*
  Which answers mean the session behind a signed-in screen has ended.

  A 401 on a signed-in screen is not a wrong password: the session expired,
  was ended from another device, or its password changed, and the person has
  to sign in again. The exceptions are the requests that exist to sign in -
  where a 401 is the answer about the password or the code - and log-out,
  whose 401 means only that there was nothing left to end.

  Its own module, with no imports, so the rule is tested as it is.
*/

const SIGN_IN_PATH = /^\/v1\/auth\/(login|register|password-reset|logout)(\/|$)/;

/** Whether a 401 on this API path means the session behind the screen has ended. */
export const endsSession = (path: string): boolean => !SIGN_IN_PATH.test(path);
