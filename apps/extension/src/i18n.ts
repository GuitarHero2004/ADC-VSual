export const text = {
  en: {
    label: 'Voice test',
    description:
      'Record, review and read back your words. Page assistance will be connected later.',
    setup:
      'This extension has not been configured. Follow the repository extension setup instructions, then rebuild and reload it.',
    session: 'Account',
    loading: 'Checking your session…',
    signin: 'Sign in',
    signinHelp:
      'Use your app account email and password. A project maintainer can find app accounts in Supabase → Authentication → Users. Signing in on the website does not sign in this extension.',
    email: 'Email',
    password: 'Password',
    signingIn: 'Signing in…',
    signout: 'Sign out',
    signedin: 'Signed in as',
    expired: 'Your session has expired. Sign in again to continue.',
    signedout: 'Signed out. Pending recording and speech have been cleared.',
    signinFirst: 'Sign in before starting the voice test.',
    shortcut: 'Keyboard shortcut',
    shortcutHelpLabel: 'Shortcut help',
    shortcutLoading: 'Checking assigned shortcut…',
    unassigned: 'No shortcut assigned.',
    shortcutFailed: 'The assigned shortcut could not be read.',
    shortcutHelp:
      'In this browser: start or finish recording, cancel a request, or stop speech.',
    changeShortcut: 'Change shortcut',
    shortcutLocation:
      'Open chrome://extensions/shortcuts in Chrome or edge://extensions/shortcuts in Edge. Set the command to “In Chrome” or “In Microsoft Edge”, not Global.',
    microphone: 'Microphone setup',
    microphoneHelp:
      'Recording is optional. If the panel cannot request microphone access, open setup in a tab. Website permission is separate.',
    openSetup: 'Open microphone setup in a tab',
    tabHelp:
      'This is the extension’s own setup tab. Start recording below to request microphone permission, then cancel to discard the recording. Return to the side panel afterwards.',
    uiLanguage: 'Interface language',
  },
  vi: {
    label: 'Thử giọng nói',
    description:
      'Ghi âm, xem lại và đọc lại lời của bạn. Trợ lý đọc trang web sẽ được kết nối sau.',
    setup:
      'Tiện ích chưa được cấu hình. Làm theo hướng dẫn cài đặt tiện ích trong kho mã, sau đó biên dịch và tải lại.',
    session: 'Tài khoản',
    loading: 'Đang kiểm tra phiên đăng nhập…',
    signin: 'Đăng nhập',
    signinHelp:
      'Dùng email và mật khẩu tài khoản ứng dụng. Người quản lý dự án có thể xem tài khoản tại Supabase → Authentication → Users. Đăng nhập trên trang web không đăng nhập tiện ích này.',
    email: 'Email',
    password: 'Mật khẩu',
    signingIn: 'Đang đăng nhập…',
    signout: 'Đăng xuất',
    signedin: 'Đã đăng nhập bằng',
    expired: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại để tiếp tục.',
    signedout: 'Đã đăng xuất. Bản ghi âm và âm thanh đang xử lý đã được xóa.',
    signinFirst: 'Hãy đăng nhập trước khi thử giọng nói.',
    shortcut: 'Phím tắt',
    shortcutHelpLabel: 'Hướng dẫn phím tắt',
    shortcutLoading: 'Đang kiểm tra phím tắt…',
    unassigned: 'Chưa gán phím tắt.',
    shortcutFailed: 'Không đọc được phím tắt đã gán.',
    shortcutHelp:
      'Trong trình duyệt: bắt đầu hoặc kết thúc ghi âm, hủy yêu cầu hay dừng giọng đọc.',
    changeShortcut: 'Đổi phím tắt',
    shortcutLocation:
      'Mở chrome://extensions/shortcuts trong Chrome hoặc edge://extensions/shortcuts trong Edge. Chọn phạm vi “In Chrome” hoặc “In Microsoft Edge”, không chọn Global.',
    microphone: 'Thiết lập micro',
    microphoneHelp:
      'Ghi âm là tùy chọn. Nếu bảng không hỏi quyền micro, mở thiết lập trong thẻ. Quyền trên trang web được cấp riêng.',
    openSetup: 'Mở thiết lập micro trong thẻ',
    tabHelp:
      'Đây là thẻ thiết lập của tiện ích. Bắt đầu ghi âm bên dưới để cấp quyền micro, rồi hủy để bỏ bản ghi. Sau đó quay lại bảng bên.',
    uiLanguage: 'Ngôn ngữ giao diện',
  },
} as const;
