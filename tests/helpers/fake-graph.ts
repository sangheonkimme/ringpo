import type { GraphClient, IgProfile, MediaInfo, PrivateReplyMessage } from "@/server/instagram/graph";

export class FakeGraphClient implements GraphClient {
  seq = 0;
  replies: { token: string; commentId: string; message: string }[] = [];
  dms: { token: string; igUserId: string; commentId: string; message: PrivateReplyMessage }[] = [];
  messages: { token: string; igUserId: string; recipientId: string; message: PrivateReplyMessage }[] = [];
  followers = new Set<string>();
  subscribed: string[] = [];
  media: Record<string, MediaInfo> = {};
  profile: IgProfile = { id: "scoped-1", userId: "17841400000000001", username: "creator", accountType: "BUSINESS", profilePictureUrl: null };
  replyError: ((n: number) => unknown) | null = null;
  dmError: ((message: PrivateReplyMessage, n: number) => unknown) | null = null;
  refreshResult: { accessToken: string; expiresIn: number } | Error = { accessToken: "refreshed", expiresIn: 5_184_000 };

  async getMe() {
    return this.profile;
  }
  async subscribeApp(_token: string, igUserId: string) {
    this.subscribed.push(igUserId);
  }
  async refreshToken() {
    if (this.refreshResult instanceof Error) throw this.refreshResult;
    return this.refreshResult;
  }
  async listMedia() {
    return { items: Object.values(this.media), nextCursor: null };
  }
  async getMedia(_token: string, mediaId: string) {
    const m = this.media[mediaId];
    if (!m) throw new Error(`no media ${mediaId}`);
    return m;
  }
  async replyToComment(token: string, commentId: string, message: string) {
    const err = this.replyError?.(this.replies.length);
    if (err) throw err;
    this.replies.push({ token, commentId, message });
    return { id: `reply-${++this.seq}` };
  }
  async sendPrivateReply(token: string, igUserId: string, commentId: string, message: PrivateReplyMessage) {
    const err = this.dmError?.(message, this.dms.length);
    if (err) throw err;
    this.dms.push({ token, igUserId, commentId, message });
    return { messageId: `mid-${++this.seq}` };
  }
  async sendMessage(token: string, igUserId: string, recipientId: string, message: PrivateReplyMessage) {
    this.messages.push({ token, igUserId, recipientId, message });
    return { messageId: `mid-${++this.seq}` };
  }
  async isFollower(_token: string, igsid: string) {
    return this.followers.has(igsid);
  }
}
