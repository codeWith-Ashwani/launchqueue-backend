const invitedEmail = require("../../templates/invitedEmail");
const confirmationEmail = require("../../templates/confirmationEmail");
describe("Notification content safety", () => {
  it("escapes founder-supplied HTML in invitations and confirmations", () => {
    const html = invitedEmail({ waitlistName: '<img src="x">', thankYouMessage: "<script>bad</script>" });
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
    expect(confirmationEmail({ waitlistName: "<b>name</b>", position: 1, shareUrl: "https://example.com/?x=1&y=2" })).toContain("&lt;b&gt;name&lt;/b&gt;");
  });
});
