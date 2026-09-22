import { type PinoLogger } from "nestjs-pino";

import { isReservedAddress, ResendMailer } from "./resend.mailer";

/*
  The provider is never reached for an address that cannot receive mail.

  Every test fixture in this repository signs up as test-<digits>-<word>@example.com,
  and example.com is reserved by RFC 2606 precisely so that nothing ever
  delivers there. Sending those anyway was costing the development account's
  daily quota on every run of the API suite, and telling the provider about
  addresses that do not exist. The guard is on the mailer rather than in the
  tests because the tests are not the only source of such addresses.
*/

const logger = { setContext: jest.fn(), info: jest.fn(), error: jest.fn() };
const mailer = () =>
  new ResendMailer("re_test_key", "BIRQ <no-reply@example.org>", logger as unknown as PinoLogger);

const mail = (to: string) => ({ to, subject: "Hello", text: "Hello.", html: "<p>Hello.</p>" });

describe("isReservedAddress", () => {
  it.each([
    "test-1789051541513-0kpy82@example.com",
    "someone@EXAMPLE.NET",
    "someone@mail.example.org",
    "someone@service.test",
    "someone@nothing.invalid",
    "someone@localhost",
    "someone@app.localhost",
    "someone@thing.example",
  ])("is true for %s", (address) => {
    expect(isReservedAddress(address)).toBe(true);
  });

  it.each([
    "abebe@gmail.com",
    "someone@example.com.et",
    "someone@examples.com",
    "someone@testing.com",
  ])("is false for %s", (address) => {
    expect(isReservedAddress(address)).toBe(false);
  });
});

describe("ResendMailer", () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"id":"1"}', { status: 200 }));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("never calls the provider for a reserved address, and says so without the address", async () => {
    await mailer().send(mail("test-1789051541513-0kpy82@example.com"));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "mail.skipped", reason: "reserved domain" }),
      expect.any(String),
    );
    const said = JSON.stringify(logger.info.mock.calls);
    expect(said).not.toContain("0kpy82");
  });

  it("sends everything else", async () => {
    await mailer().send(mail("abebe@gmail.com"));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      to: ["abebe@gmail.com"],
      subject: "Hello",
    });
  });
});
