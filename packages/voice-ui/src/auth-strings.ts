import type { AuthFailureCode, UiLanguage } from '@adc/contracts';

export const authCopy = {
  en: {
    title: 'Sign in to VSual',
    account: 'Account',
    email: 'Email',
    password: 'Password',
    show: 'Show password',
    hide: 'Hide password',
    signIn: 'Sign in',
    working: 'Signing in…',
    google: 'Continue with Google',
    googleUnavailable:
      'Google sign-in is not available here yet. You can use email and password.',
    emailRequired: 'Enter a valid email address.',
    passwordRequired: 'Enter your password.',
    language: 'Interface language',
    cancel: 'Cancel sign-in',
    retry: 'Try again',
    return: 'Return to VSual',
    checking: 'Checking your account…',
    extensionIntro:
      'The VSual extension opened this page. Sign in to connect your account to that extension for this browser session.',
    separate:
      'Your website and extension sessions are separate. Signing in here for the extension does not change the website account.',
    websiteAccount: 'Website account',
    connected: 'Connected to VSual',
    signedIn: 'Signed in',
    allowed:
      'Workspace access is available. Return to VSual to ask a question.',
    denied:
      'Signed in, but this account does not have access to the configured workspace. Contact your project maintainer or sign out in VSual and choose another account.',
    unavailable:
      'Your account is signed in, but workspace access could not be checked. Check your connection and retry in VSual.',
    pending:
      'Complete sign-in. You can cancel and return to VSual at any time.',
    cancelled:
      'Sign-in cancelled. Return to VSual and choose Sign in to start again.',
    returnHelp:
      'If the panel does not reopen, use the pinned VSual toolbar button or its keyboard shortcut.',
    webIntro:
      'Sign in to use the VSual website. To connect the extension, start with its Sign in button.',
    webContinue: 'Continue to voice setup',
    signOut: 'Sign out of this website',
    signingOut: 'Signing out…',
    logoutOffline:
      'Signed out on this device. The server could not confirm sign-out; reconnect before using this account again.',
    existing:
      'This website is already signed in. Sign out below to use a different account.',
  },
  vi: {
    title: 'Đăng nhập VSual',
    account: 'Tài khoản',
    email: 'Email',
    password: 'Mật khẩu',
    show: 'Hiện mật khẩu',
    hide: 'Ẩn mật khẩu',
    signIn: 'Đăng nhập',
    working: 'Đang đăng nhập…',
    google: 'Tiếp tục với Google',
    googleUnavailable:
      'Đăng nhập Google chưa khả dụng tại đây. Bạn có thể dùng email và mật khẩu.',
    emailRequired: 'Nhập địa chỉ email hợp lệ.',
    passwordRequired: 'Nhập mật khẩu.',
    language: 'Ngôn ngữ giao diện',
    cancel: 'Hủy đăng nhập',
    retry: 'Thử lại',
    return: 'Quay lại VSual',
    checking: 'Đang kiểm tra tài khoản…',
    extensionIntro:
      'Tiện ích VSual đã mở trang này. Đăng nhập để kết nối tài khoản với tiện ích trong phiên trình duyệt này.',
    separate:
      'Phiên đăng nhập trang web và tiện ích độc lập. Đăng nhập cho tiện ích tại đây không thay đổi tài khoản trên trang web.',
    websiteAccount: 'Tài khoản trang web',
    connected: 'Đã kết nối với VSual',
    signedIn: 'Đã đăng nhập',
    allowed:
      'Bạn có quyền truy cập không gian làm việc. Quay lại VSual để đặt câu hỏi.',
    denied:
      'Đã đăng nhập nhưng tài khoản chưa có quyền truy cập không gian làm việc đã cấu hình. Liên hệ người quản lý dự án hoặc đăng xuất trong VSual để chọn tài khoản khác.',
    unavailable:
      'Đã đăng nhập nhưng chưa thể kiểm tra quyền truy cập không gian làm việc. Kiểm tra kết nối rồi thử lại trong VSual.',
    pending:
      'Hoàn tất đăng nhập. Bạn có thể hủy và quay lại VSual bất cứ lúc nào.',
    cancelled:
      'Đã hủy đăng nhập. Quay lại VSual và chọn Đăng nhập để bắt đầu lại.',
    returnHelp:
      'Nếu bảng tiện ích không mở lại, hãy dùng nút VSual đã ghim trên thanh công cụ hoặc phím tắt.',
    webIntro:
      'Đăng nhập để sử dụng trang web VSual. Để kết nối tiện ích, hãy bắt đầu bằng nút Đăng nhập trong tiện ích.',
    webContinue: 'Tiếp tục đến thiết lập giọng nói',
    signOut: 'Đăng xuất khỏi trang web này',
    signingOut: 'Đang đăng xuất…',
    logoutOffline:
      'Đã đăng xuất trên thiết bị này. Máy chủ chưa xác nhận đăng xuất; hãy kết nối lại trước khi sử dụng tài khoản này.',
    existing:
      'Trang web này đã đăng nhập. Đăng xuất bên dưới để sử dụng tài khoản khác.',
  },
} as const;

const failures: Record<AuthFailureCode, { en: string; vi: string }> = {
  INVALID_CREDENTIALS: {
    en: 'The email or password was not accepted. Check them and try again.',
    vi: 'Email hoặc mật khẩu chưa đúng. Kiểm tra rồi thử lại.',
  },
  EMAIL_UNCONFIRMED: {
    en: 'Confirm your email before signing in.',
    vi: 'Hãy xác nhận email trước khi đăng nhập.',
  },
  RATE_LIMITED: {
    en: 'Too many sign-in attempts. Wait a few minutes and try again.',
    vi: 'Có quá nhiều lần đăng nhập. Đợi vài phút rồi thử lại.',
  },
  UNAVAILABLE: {
    en: 'Could not verify your session. Check your connection and try again.',
    vi: 'Chưa thể xác minh phiên đăng nhập. Kiểm tra kết nối rồi thử lại.',
  },
  SESSION_EXPIRED: {
    en: 'Your session is no longer valid. Sign in again.',
    vi: 'Phiên đăng nhập không còn hợp lệ. Hãy đăng nhập lại.',
  },
  CANCELLED: {
    en: 'Sign-in was cancelled. You can try again.',
    vi: 'Đã hủy đăng nhập. Bạn có thể thử lại.',
  },
  ATTEMPT_EXPIRED: {
    en: 'This sign-in attempt expired. Return to VSual and start again.',
    vi: 'Lần đăng nhập này đã hết hạn. Quay lại VSual và bắt đầu lại.',
  },
  INVALID_ATTEMPT: {
    en: 'This page cannot connect to the initiating extension. Return to VSual and start sign-in again.',
    vi: 'Trang này không thể kết nối với tiện ích đã yêu cầu đăng nhập. Quay lại VSual và đăng nhập lại.',
  },
  GOOGLE_UNAVAILABLE: {
    en: 'Google sign-in is not configured. Use email and password.',
    vi: 'Chưa cấu hình đăng nhập Google. Hãy dùng email và mật khẩu.',
  },
  PROVIDER_ERROR: {
    en: 'The sign-in provider could not complete this request. Try again or use email and password.',
    vi: 'Dịch vụ đăng nhập chưa thể hoàn tất yêu cầu. Thử lại hoặc dùng email và mật khẩu.',
  },
  CALLBACK_MISMATCH: {
    en: 'The sign-in return address was not accepted. Start again from VSual.',
    vi: 'Địa chỉ quay lại sau đăng nhập không được chấp nhận. Bắt đầu lại từ VSual.',
  },
  ACCOUNT_CHANGE_REQUIRED: {
    en: 'VSual already has an account connected. Sign out in the extension before changing accounts.',
    vi: 'VSual đã kết nối một tài khoản. Hãy đăng xuất trong tiện ích trước khi đổi tài khoản.',
  },
  SETUP_REQUIRED: {
    en: 'Sign-in is not configured. Ask your project maintainer to complete setup.',
    vi: 'Chưa cấu hình đăng nhập. Nhờ người quản lý dự án hoàn tất thiết lập.',
  },
  FORBIDDEN: {
    en: 'This sign-in request is not allowed. Return to VSual and start again.',
    vi: 'Yêu cầu đăng nhập này không được cho phép. Quay lại VSual và bắt đầu lại.',
  },
};

export function authFailureText(
  code: AuthFailureCode,
  language: UiLanguage,
): string {
  return failures[code][language];
}
