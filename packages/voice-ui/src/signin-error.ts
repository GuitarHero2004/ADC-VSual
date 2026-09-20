const messages = {
  invalid_credentials: {
    en: 'The email or password was not accepted, or this app account does not exist. Use an existing app account.',
    vi: 'Email hoặc mật khẩu không được chấp nhận, hoặc tài khoản ứng dụng này chưa tồn tại. Hãy dùng tài khoản ứng dụng đã có.',
  },
  email_not_confirmed: {
    en: 'Confirm your email before signing in. Check your confirmation email or contact the project owner.',
    vi: 'Hãy xác nhận email trước khi đăng nhập. Kiểm tra email xác nhận hoặc liên hệ người quản lý dự án.',
  },
  email_provider_disabled: {
    en: 'Email/password authentication is unavailable for this project. Ask the project owner to check the email provider settings.',
    vi: 'Dự án chưa cho phép xác thực bằng email/mật khẩu. Hãy nhờ người quản lý dự án kiểm tra cài đặt xác thực email.',
  },
  provider_disabled: {
    en: 'This sign-in method is disabled for this project. Contact the project owner.',
    vi: 'Phương thức đăng nhập này đang bị tắt trong dự án. Hãy liên hệ người quản lý dự án.',
  },
  signup_disabled: {
    en: 'New account creation is disabled. Use an existing app account or contact the project owner.',
    vi: 'Tính năng tạo tài khoản mới đang bị tắt. Hãy dùng tài khoản ứng dụng đã có hoặc liên hệ người quản lý dự án.',
  },
  user_banned: {
    en: 'This app account is suspended. Contact the project owner before trying again.',
    vi: 'Tài khoản ứng dụng này đang bị tạm khóa. Hãy liên hệ người quản lý dự án trước khi thử lại.',
  },
  over_request_rate_limit: {
    en: 'Too many sign-in attempts. Wait a few minutes before trying again.',
    vi: 'Có quá nhiều lần đăng nhập. Hãy đợi vài phút rồi thử lại.',
  },
  request_timeout: {
    en: 'Sign-in timed out. Check your connection and try again.',
    vi: 'Đăng nhập đã hết thời gian chờ. Hãy kiểm tra kết nối rồi thử lại.',
  },
  unexpected_failure: {
    en: 'The sign-in service could not complete this request. Try again later or contact the project owner.',
    vi: 'Dịch vụ đăng nhập chưa thể xử lý yêu cầu này. Hãy thử lại sau hoặc liên hệ người quản lý dự án.',
  },
} as const;

const networkMessages = {
  en: 'Could not reach the sign-in service. Check your connection and try again.',
  vi: 'Không thể kết nối với dịch vụ đăng nhập. Hãy kiểm tra kết nối rồi thử lại.',
} as const;

const fallbackMessages = {
  en: 'Sign-in failed. Try again later or contact the project owner.',
  vi: 'Đăng nhập không thành công. Hãy thử lại sau hoặc liên hệ người quản lý dự án.',
} as const;

/** Present only application-owned copy and explicitly allowed diagnostic codes. */
export function signInErrorMessage(
  error: unknown,
  language: 'en' | 'vi',
): string {
  if (typeof error !== 'object' || error === null) {
    return fallbackMessages[language];
  }

  if ('code' in error && typeof error.code === 'string') {
    if (Object.hasOwn(messages, error.code)) {
      const code = error.code as keyof typeof messages;
      return `${messages[code][language]} (${code})`;
    }
  }

  if (
    'name' in error &&
    (error.name === 'AuthRetryableFetchError' || error.name === 'TypeError')
  ) {
    return networkMessages[language];
  }

  return fallbackMessages[language];
}
