/**
 * A time-of-day greeting for the account home page, the way an exchange app
 * opens with "Good morning" rather than a page name. Bucketed the way a
 * person would say it out loud, not by even hours.
 */
export function greetingForHour(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  if (hour < 22) return "Good evening";
  return "Good night";
}

/** `date` defaults to now; a parameter exists so this is easy to test. */
export function timeGreeting(date: Date = new Date()): string {
  return greetingForHour(date.getHours());
}
