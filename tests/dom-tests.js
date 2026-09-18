"use strict";

const results = [];

function test(name, assertion) {
  try {
    const passed = Boolean(assertion());
    results.push({ name, passed, error: passed ? "" : "기대값과 다릅니다." });
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
  }
}

const testState = DCFCore.sanitizeState({
  settings: {
    hideAnonymousPosts: false,
    hideAnonymousComments: false,
    subjectFilterPanelOpacity: 100
  },
  highlights: [
    {
      id: "highlight-fixed",
      matchType: "uid",
      value: "fixed_user",
      label: "테스트 작성자",
      color: "#ff82b5"
    }
  ],
  galleryAffixesByGalleryKey: {
    "major:test_gallery": {
      galleryKey: "major:test_gallery",
      postHeader: "머리말",
      postHeaderColor: "#ff3366",
      postHeaderCss: "font-size: 18px; font-weight: 700; text-align: center",
      postFooter: "꼬리말",
      postFooterColor: "#4455cc",
      postFooterCss: "font-style: italic; text-align: right",
      commentFooter: "댓글꼬리"
    }
  },
  subjectFiltersByGalleryKey: {
    "major:test_gallery": {
      galleryKey: "major:test_gallery",
      mode: "include",
      subjects: ["A"]
    }
  }
});
DCFContentTest.setStateForTest(testState);

test("유동 작성자를 data-uid/data-ip로 판별", () => {
  return (
    DCFCore.classifyWriter(document.getElementById("anonymous-writer")).kind ===
    "anonymous"
  );
});

test("고정닉 아이콘을 고닉으로 판별", () => {
  return (
    DCFCore.classifyWriter(document.getElementById("fixed-writer")).kind ===
    "fixed"
  );
});

test("반고닉 아이콘을 고닉보다 우선 판별", () => {
  return (
    DCFCore.classifyWriter(document.getElementById("semi-writer")).kind ===
    "semi"
  );
});

test("게시물 작성자에서 목록 행을 찾음", () => {
  return (
    DCFContentTest.findPostContainer(
      document.getElementById("anonymous-writer")
    )?.id === "anonymous-post"
  );
});

test("본문 아래 목록의 실제 글 행만 수집하고 광고 행은 제외", () => {
  const rows = DCFContentTest.collectPostRows();
  return (
    DCFContentTest.findPostContainer(
      document.getElementById("bottom-anonymous-writer")
    )?.id === "bottom-anonymous-post" &&
    rows.includes(document.getElementById("bottom-anonymous-post")) &&
    rows.includes(document.getElementById("bottom-fixed-post")) &&
    !rows.includes(document.getElementById("bottom-ad-row"))
  );
});

test("댓글 작성자에서 댓글 행을 찾음", () => {
  return (
    DCFContentTest.findCommentContainer(
      document.getElementById("anonymous-comment-writer")
    )?.id === "comment_li_1"
  );
});

test("유동 닉네임 사칭은 강조하지 않음", () => {
  const author = DCFCore.classifyWriter(
    document.getElementById("anonymous-writer")
  );
  return (
    DCFCore.matchingHighlight(author, [
      { matchType: "nick", value: "ㅇㅇ", color: "#fff1a8" }
    ]) === null
  );
});

test("등록 사용자도 닉네임만으로는 강조하지 않음", () => {
  const author = DCFCore.classifyWriter(document.getElementById("fixed-writer"));
  return (
    DCFCore.matchingHighlight(author, [
      { matchType: "nick", value: "고정닉", color: "#fff1a8" }
    ]) === null
  );
});

test("등록 사용자의 식별 코드 강조가 일치", () => {
  const author = DCFCore.classifyWriter(document.getElementById("fixed-writer"));
  return Boolean(
    DCFCore.matchingHighlight(author, [
      { matchType: "uid", value: "FIXED_USER", color: "#fff1a8" }
    ])
  );
});

test("등록 사용자 강조는 게시물 영역이 아니라 닉네임에만 적용", () => {
  const listWriter = document.getElementById("fixed-writer");
  const viewWriter = document.getElementById("view-writer");
  DCFContentTest.processWriter(listWriter);
  DCFContentTest.processWriter(viewWriter);
  return (
    listWriter.querySelector(".nickname").classList.contains(
      "dcf-highlighted-nickname"
    ) &&
    viewWriter.querySelector(".nickname").classList.contains(
      "dcf-highlighted-nickname"
    ) &&
    !document.getElementById("fixed-post").classList.contains(
      "dcf-highlighted-author"
    ) &&
    !document.querySelector(".gallview_head").classList.contains(
      "dcf-highlighted-view"
    )
  );
});

test("본문 아래 목록에도 유동 숨김·닉네임 강조·말머리 필터를 적용", () => {
  const anonymousWriter = document.getElementById("bottom-anonymous-writer");
  const fixedWriter = document.getElementById("bottom-fixed-writer");
  DCFContentTest.processWriter(anonymousWriter);
  DCFContentTest.processWriter(fixedWriter);
  DCFContentTest.applySubjectFilter(document);
  return (
    document
      .getElementById("bottom-anonymous-post")
      .classList.contains("dcf-anonymous-post") &&
    document
      .getElementById("bottom-anonymous-post")
      .classList.contains("dcf-subject-filtered") &&
    fixedWriter
      .querySelector(".nickname")
      .classList.contains("dcf-highlighted-nickname") &&
    !document
      .getElementById("bottom-fixed-post")
      .classList.contains("dcf-subject-filtered")
  );
});

test("ID와 IP가 동시에 있으면 unknown으로 처리", () => {
  const writer = document.getElementById("fixed-writer").cloneNode(true);
  writer.setAttribute("data-ip", "127.1");
  return DCFCore.classifyWriter(writer).kind === "unknown";
});

test("게시물 주소에서 page 등 추적 파라미터 제거", () => {
  return (
    DCFCore.canonicalizeDcUrl(
      "https://gall.dcinside.com/board/view/?id=test_gallery&no=123&page=7&t=cv"
    ) ===
    "https://gall.dcinside.com/board/view/?id=test_gallery&no=123"
  );
});

test("게시물 메타데이터 추출", () => {
  const metadata = DCFContentTest.extractPageMetadata();
  return (
    metadata?.title === "테스트 게시물 제목" &&
    metadata?.galleryId === "test_gallery" &&
    metadata?.postNo === "123" &&
    metadata?.author?.uid === "fixed_user"
  );
});

test("갤러리 종류를 포함한 키를 추출", () => {
  return (
    DCFContentTest.getGalleryContext()?.galleryKey === "major:test_gallery"
  );
});

test("로그인 영역에서 본인 갤로그와 운영 역할을 추출", () => {
  const viewer = DCFContentTest.extractViewerContext();
  return (
    viewer?.gallogId === "tester" &&
    viewer?.nickname === "테스트사용자" &&
    viewer.galleries.some(
      (gallery) =>
        gallery.galleryKey === "minor:managed_main" &&
        gallery.role === "manager"
    ) &&
    viewer.galleries.some(
      (gallery) =>
        gallery.galleryKey === "mini:managed_sub" &&
        gallery.role === "submanager"
    )
  );
});

test("공식 운영 목록의 슬래시 없는 미니갤 주소를 추출", () => {
  const popup = document.createElement("div");
  popup.id = "my_minor_pop";
  popup.innerHTML = `
    <ul class="my_minor_list">
      <li>
        <a href="https://gall.dcinside.com/mini/board/lists?id=test_managed_gallery" class="mgll_name add">테스트 갤러리</a>
        <span class="mng">매니저</span>
      </li>
    </ul>
  `;
  document.body.append(popup);
  const galleries = DCFContentTest.managedGalleriesFromDom(popup);
  popup.remove();
  return galleries.some(
    (gallery) =>
      gallery.galleryKey === "mini:test_managed_gallery" &&
      gallery.galleryName === "테스트 갤러리" &&
      gallery.role === "manager"
  );
});

test("오른쪽 로그인 상자에 링크가 없어도 공식 헤더에서 본인 ID를 추출", () => {
  const loginLink = document.querySelector(
    "#login_box a[href*='gallog.dcinside.com/']"
  );
  const originalHref = loginLink.getAttribute("href");
  loginLink.removeAttribute("href");
  const identityRoot = document.createElement("div");
  identityRoot.className = "area_nickname";
  identityRoot.innerHTML =
    '<ul class="user_data_list"><li><a href="//gallog.dcinside.com/tester">내 갤로그</a></li></ul>';
  document.body.append(identityRoot);
  const viewer = DCFContentTest.extractViewerContext();
  identityRoot.remove();
  loginLink.setAttribute("href", originalHref);
  return viewer?.gallogId === "tester";
});

test("검증된 본문 하나만 선택", () => {
  return DCFContentTest.findPostBody()?.id === "post-body";
});

test("목록 행에서 말머리를 추출", () => {
  return (
    DCFContentTest.extractPostSubject(document.getElementById("anonymous-post")) ===
      "A" &&
    DCFContentTest.extractPostSubject(document.getElementById("fixed-post")) ===
      "B" &&
    DCFContentTest.availablePostSubjects().join(",") === "A,B,🐥C,D"
  );
});

test("말머리 탭 줄과 장식 아이콘을 포함한 전체 말머리를 찾음", () => {
  return (
    DCFContentTest.findSubjectTabBar()?.id === "subject-tabs" &&
    DCFContentTest.subjectNamesFromTabBar(
      document.getElementById("subject-tabs")
    ).join(",") === "A,B,🐥C,D" &&
    !DCFContentTest.availablePostSubjects().includes("개념글") &&
    !DCFContentTest.availablePostSubjects().includes("공지")
  );
});

test("말머리 탭 오른쪽 설정 아이콘을 한 번만 삽입", () => {
  DCFContentTest.injectSubjectFilterControl();
  DCFContentTest.injectSubjectFilterControl();
  return (
    document.querySelectorAll("#dcf-subject-filter-slot").length === 1 &&
    document.querySelectorAll("#dcf-subject-filter-panel").length === 1 &&
    document.getElementById("dcf-subject-filter-slot")?.parentElement?.id ===
      "subject-tabs"
  );
});

test("설정창에 말머리 체크박스와 보기·안 보기 스위치를 표시", () => {
  document.getElementById("dcf-subject-filter-button").click();
  const panel = document.getElementById("dcf-subject-filter-panel");
  return (
    !panel.hidden &&
    panel.dataset.mode === "include" &&
    !panel.querySelector("#dcf-subject-filter-mode").checked &&
    panel.querySelector("#dcf-subject-write-follow").checked &&
    [...panel.querySelector("#dcf-subject-write-default").options]
      .map((option) => option.textContent)
      .join(",") === "사이트 기본값,A,B,🐥C,D" &&
    panel.querySelector("input[value='A']").checked &&
    !panel.querySelector("[data-dcf-subject-status]") &&
    panel.querySelector("#dcf-subject-filter-opacity")?.min === "0" &&
    panel.querySelector("#dcf-subject-filter-opacity")?.max === "100" &&
    panel.querySelector("#dcf-subject-filter-opacity")?.step === "5" &&
    panel.querySelector("#dcf-subject-filter-opacity")?.value === "100" &&
    panel.querySelector("[data-dcf-subject-opacity-value]")?.textContent ===
      "100%" &&
    panel.style.getPropertyValue("--dcf-subject-filter-panel-opacity") === "1" &&
    [...panel.querySelectorAll(".dcf-subject-filter-option span")]
      .map((element) => element.textContent)
      .join(",") === "A,B,🐥C,D"
  );
});

test("말머리 필터 불투명도 슬라이더를 움직이면 바로 미리 본다", () => {
  const panel = document.getElementById("dcf-subject-filter-panel");
  const slider = panel.querySelector("#dcf-subject-filter-opacity");
  slider.value = "65";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  const passed =
    panel.style.getPropertyValue("--dcf-subject-filter-panel-opacity") ===
      "0.65" &&
    panel.querySelector("[data-dcf-subject-opacity-value]")?.textContent ===
      "65%";
  slider.value = "100";
  slider.dispatchEvent(new Event("input", { bubbles: true }));
  return passed;
});

test("보고 있던 말머리를 기억해 글쓰기에서 기본값보다 먼저 선택", () => {
  testState.subjectWriteSettingsByGalleryKey["major:test_gallery"] = {
    galleryKey: "major:test_gallery",
    galleryKind: "major",
    galleryId: "test_gallery",
    followCurrentTab: true,
    defaultSubject: "정보",
    defaultSubjectNo: "20"
  };
  DCFContentTest.setStateForTest(testState);
  const subjectLink = document.querySelector("#subject-tabs a[data-no='10']");
  DCFContentTest.handleSubjectTabSelection({ target: subjectLink });
  const form = document.getElementById("write-form");
  delete form.dataset.dcfWriteSubjectApplied;
  form.querySelector("#headtext").value = "20";
  const applied = DCFContentTest.applyWriteSubjectSetting(form);
  const remembered = DCFContentTest.rememberedCurrentSubject();
  return (
    applied &&
    remembered?.subject === "A" &&
    remembered?.subjectNo === "10" &&
    form.querySelector("#headtext").value === "10" &&
    form.querySelector("li[data-no='10']").classList.contains("sel")
  );
});

test("현재 탭 우선을 끄면 갤러리 기본 말머리를 선택", () => {
  testState.subjectWriteSettingsByGalleryKey["major:test_gallery"] = {
    ...testState.subjectWriteSettingsByGalleryKey["major:test_gallery"],
    followCurrentTab: false
  };
  DCFContentTest.setStateForTest(testState);
  DCFContentTest.rememberCurrentSubject({ subject: "A", subjectNo: "10" });
  const form = document.getElementById("write-form");
  delete form.dataset.dcfWriteSubjectApplied;
  form.querySelector("#headtext").value = "0";
  const applied = DCFContentTest.applyWriteSubjectSetting(form);
  const passed =
    applied &&
    form.querySelector("#headtext").value === "20" &&
    form.querySelector("li[data-no='20']").classList.contains("sel");
  delete testState.subjectWriteSettingsByGalleryKey["major:test_gallery"];
  DCFContentTest.setStateForTest(testState);
  DCFContentTest.rememberCurrentSubject(null);
  return passed;
});

test("사이트가 말머리 줄을 다시 그려도 설정 버튼을 재연결", () => {
  const current = document.getElementById("subject-tabs");
  current.replaceWith(current.cloneNode(true));
  DCFContentTest.injectSubjectFilterControl();
  const button = document.getElementById("dcf-subject-filter-button");
  button.click();
  button.click();
  return (
    document.querySelectorAll("#dcf-subject-filter-slot").length === 1 &&
    !document.getElementById("dcf-subject-filter-panel").hidden
  );
});

test("글 머리말·꼬리말을 재클릭해도 한 번만 적용", () => {
  const form = document.getElementById("write-form");
  DCFContentTest.applyPostAffixes(form);
  DCFContentTest.applyPostAffixes(form);
  const text = form.querySelector(".note-editable").textContent;
  const header = form.querySelector('[data-nanatool-affix="post-header"]');
  const footer = form.querySelector('[data-nanatool-affix="post-footer"]');
  return (
    text.split("머리말").length === 2 &&
    text.split("꼬리말").length === 2 &&
    getComputedStyle(header).color === "rgb(255, 51, 102)" &&
    header.style.fontSize === "18px" &&
    header.style.textAlign === "center" &&
    getComputedStyle(footer).color === "rgb(68, 85, 204)" &&
    footer.style.fontStyle === "italic" &&
    document.getElementById("memo").value.includes("data-nanatool-affix")
  );
});

test("공식 운영 목록 응답에서 갤러리와 역할을 읽음", () => {
  const galleries = DCFContentTest.parseManagedGalleryPayload(
    JSON.stringify({
      rows: [
        {
          gall_id: "managed_main",
          gall_name: "주딱 갤러리",
          gall_type: "MG",
          role: "매니저"
        },
        {
          gall_id: "managed_sub",
          gall_name: "파딱 갤러리",
          gall_type: "MI",
          role: "부매니저"
        }
      ]
    })
  );
  return (
    galleries.some(
      (gallery) =>
        gallery.galleryKey === "minor:managed_main" &&
        gallery.role === "manager"
    ) &&
    galleries.some(
      (gallery) =>
        gallery.galleryKey === "mini:managed_sub" &&
        gallery.role === "submanager"
    )
  );
});

test("활동 명함을 글 꼬리말 맨 뒤에 한 번만 삽입", () => {
  testState.galleryAffixesByGalleryKey["major:test_gallery"] = {
    ...testState.galleryAffixesByGalleryKey["major:test_gallery"],
    postFooter:
      '<div data-nanatool-profile-card style="position:relative;position:fixed" onclick="alert(1)"><img data-nanatool-character src="{{캐릭터이미지}}"><strong>{{닉네임}}</strong><span>글댓비 {{글댓비}}</span><div data-nanatool-managed-galleries><a data-nanatool-managed-gallery-template><img data-nanatool-managed-gallery-badge><span data-nanatool-managed-gallery-role>운영</span><span data-nanatool-managed-gallery-name>갤러리</span></a></div><script>alert(1)</script></div>'
  };
  DCFContentTest.setStateForTest(testState);
  DCFContentTest.setProfileSnapshotForTest({
    savedAt: 123,
    profile: {
      gallogId: "tester",
      nickname: "테스트사용자",
      posts: 120,
      comments: 360,
      todayVisitors: 7,
      totalVisitors: 2048
    },
    galleries: [
      {
        galleryKey: "minor:managed_main",
        galleryKind: "minor",
        galleryId: "managed_main",
        galleryName: "주딱 갤러리",
        role: "manager",
        url: "https://gall.dcinside.com/mgallery/board/lists/?id=managed_main"
      },
      {
        galleryKey: "mini:managed_sub",
        galleryKind: "mini",
        galleryId: "managed_sub",
        galleryName: "파딱 갤러리",
        role: "submanager",
        url: "https://gall.dcinside.com/mini/board/lists/?id=managed_sub"
      }
    ]
  });
  const form = document.getElementById("write-form");
  DCFContentTest.applyPostAffixes(form);
  DCFContentTest.applyPostAffixes(form);
  const cards = form.querySelectorAll("[data-nanatool-profile-card]");
  const card = cards[0];
  const footer = form.querySelector('[data-nanatool-affix="post-footer"]');
  const checks = {
    oneCard: cards.length === 1,
    lastChild: form.querySelector(".note-editable").lastElementChild === footer,
    nickname: card?.textContent.includes("테스트사용자"),
    ratioLabel: card?.textContent.includes("글댓비"),
    ratioValue: card?.textContent.includes("1 : 3.0"),
    manager: card?.textContent.includes("주딱"),
    submanager: card?.textContent.includes("파딱"),
    portraitPlaceholder:
      card?.querySelector("img[data-nanatool-character]")?.hasAttribute("src") ===
      false,
    memo: document.getElementById("memo").value.includes("profile-card"),
    scriptRemoved: !card?.querySelector("script"),
    eventRemoved: !card?.hasAttribute("onclick"),
    fixedPositionRemoved: !card?.style.cssText.includes("fixed")
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(JSON.stringify(checks));
  }
  return true;
});

test("갤로그 HTML에서 프로필 사진의 갱신 주소를 읽음", () => {
  const profile = DCFContentTest.parseGallogProfile(
    '<div class="galler_info"><strong class="nick_name">테스트사용자</strong></div>' +
      '<img id="profile_img" src="https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=profile&amp;gid=tester&amp;t=1787980878">',
    "tester"
  );
  return (
    profile.profileImageUrl ===
    "https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=profile&gid=tester&t=1787980878"
  );
});

test("현재 명함은 저장된 꼬리말 CSS를 보존하고 값만 채움", () => {
  const source =
    '<table data-nanatool-profile-card data-nanatool-profile-layout="template-v5" style="width:auto;max-width:456px;background-color:transparent"><tbody><tr><td style="padding:7px"><img data-nanatool-character src="{{캐릭터이미지}}"><a data-nanatool-gallog>{{닉네임}}</a><strong>{{게시글수}}</strong></td></tr><tr data-nanatool-managed-section><td><div data-nanatool-managed-galleries><a data-nanatool-managed-gallery-template style="font-size:13px"><img data-nanatool-managed-gallery-badge><span data-nanatool-managed-gallery-role>운영</span><span data-nanatool-managed-gallery-name>갤러리</span></a></div></td></tr></tbody></table>';
  const record = DCFContentTest.makePostFooterBlock(source, "", "", {
    savedAt: 456,
    profile: {
      gallogId: "tester",
      nickname: "테스트사용자",
      posts: 120,
      comments: 360,
      todayVisitors: 7,
      totalVisitors: 2048
    },
    galleries: [
      {
        galleryKey: "minor:managed_main",
        galleryKind: "minor",
        galleryId: "managed_main",
        galleryName: "주딱 갤러리",
        role: "manager",
        url: "https://gall.dcinside.com/mgallery/board/lists/?id=managed_main"
      }
    ]
  });
  const card = record.node.querySelector("[data-nanatool-profile-card]");
  const gallery = card?.querySelector("[data-nanatool-managed-galleries] a");
  const checks = {
    layout:
      card?.getAttribute("data-nanatool-profile-layout") === "template-v5",
    width: card?.style.maxWidth === "456px",
    transparent: card?.style.backgroundColor === "transparent",
    padding: card?.querySelector("td")?.style.padding === "7px",
    values: card?.textContent.includes("테스트사용자120"),
    portraitPlaceholder:
      card?.querySelector("img[data-nanatool-character]")?.hasAttribute("src") ===
      false,
    galleryHref: gallery?.getAttribute("href")?.includes("managed_main"),
    galleryRole: gallery?.textContent.includes("주딱"),
    galleryName: gallery?.textContent.includes("주딱 갤러리"),
    itemCss: gallery?.style.fontSize === "13px",
    templateConsumed: !card?.querySelector(
      "[data-nanatool-managed-gallery-template]"
    )
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(JSON.stringify(checks));
  }
  return true;
});

test("기존 꼬리말의 갤로그 프로필 주소만 최신 갱신 주소로 보정", () => {
  const source =
    '<table data-nanatool-profile-card data-nanatool-profile-layout="template-v7"><tbody><tr><td><div><img src="https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=top&amp;gid=test_user"></div><img src="https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=profile&amp;gid={{갤로그ID}}"><span>{{닉네임}}</span></td></tr></tbody></table>';
  const record = DCFContentTest.makePostFooterBlock(source, "", "", {
    savedAt: 789,
    profile: {
      gallogId: "tester",
      nickname: "테스트사용자",
      profileImageUrl:
        "https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=profile&gid=tester&t=1787980878",
      posts: 1,
      comments: 2,
      todayVisitors: 3,
      totalVisitors: 4
    },
    galleries: []
  });
  const card = record.node.querySelector("[data-nanatool-profile-card]");
  const profile = card?.querySelector("img[src*='mode=profile']");
  const top = card?.querySelector("img[src*='mode=top']");
  return (
    card?.getAttribute("data-nanatool-profile-layout") === "template-v7" &&
    profile?.getAttribute("src") ===
      "https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=profile&gid=tester&t=1787980878" &&
    top?.getAttribute("src") ===
      "https://dcimg2.dcinside.co.kr/gallog_upimg.php?mode=top&gid=test_user" &&
    card?.textContent.includes("테스트사용자") &&
    !/\{\{[^}]+\}\}/.test(record.node.innerHTML)
  );
});

test("편집기에 남은 data 이미지는 등록 HTML에서 제거", () => {
  const form = document.getElementById("write-form");
  const portrait = form.querySelector(
    "[data-nanatool-affix='post-footer'] img[data-nanatool-character]"
  );
  portrait.src =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  DCFContentTest.applyPostAffixes(form);
  return (
    !portrait.hasAttribute("src") &&
    !document.getElementById("memo").value.includes("data:image/") &&
    document.getElementById("memo").value.length < 20000
  );
});

test("디시 게시 후 생존용 table 태그와 안전 속성을 유지", () => {
  const fragment = DCFContentTest.sanitizeFooterTemplate(
    '<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f8fd" onclick="alert(1)"><tbody><tr><td colspan="2" valign="top">내용</td></tr></tbody></table>'
  );
  const table = fragment.querySelector("table");
  const cell = fragment.querySelector("td");
  return (
    table?.getAttribute("width") === "100%" &&
    table?.getAttribute("bgcolor") === "#f7f8fd" &&
    !table?.hasAttribute("onclick") &&
    cell?.getAttribute("colspan") === "2" &&
    cell?.getAttribute("valign") === "top"
  );
});

test("댓글 꼬리말을 재클릭해도 한 번만 적용", () => {
  const submit = document.getElementById("comment-submit");
  DCFContentTest.applyCommentFooter(submit);
  DCFContentTest.applyCommentFooter(submit);
  return document.getElementById("comment-text").value === "댓글 내용\n댓글꼬리";
});

test("상단 수정 버튼은 하단 원본 버튼에 위임", () => {
  let forwarded = 0;
  document
    .getElementById("original-edit")
    .addEventListener("click", () => forwarded++);
  DCFContentTest.injectTopPostActions(DCFContentTest.findPostBody());
  document
    .querySelector("#dcf-top-post-actions button[data-action='수정']")
    .click();
  return forwarded === 1;
});

test("본문 이미지에 글 북마크와 별개의 이미지 북마크 버튼을 붙임", () => {
  const image = document.getElementById("post-image");
  const responsive = document.createElement("img");
  responsive.setAttribute(
    "data-srcset",
    "https://dcimg2.dcinside.co.kr/thumb.png 320w, https://dcimg2.dcinside.co.kr/original.avif 1280w"
  );
  const linked = document.createElement("a");
  linked.href = "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=99";
  const linkedImage = document.createElement("img");
  linkedImage.src = "https://dcimg2.dcinside.co.kr/thumb.webp";
  linked.append(linkedImage);
  const lazyImage = document.createElement("img");
  lazyImage.setAttribute(
    "data-image-src",
    "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=100"
  );
  const picture = document.createElement("picture");
  const pictureSource = document.createElement("source");
  pictureSource.setAttribute(
    "srcset",
    "https://dcimg2.dcinside.co.kr/picture-small.webp 1x, https://dcimg2.dcinside.co.kr/picture-large.avif 2x"
  );
  const pictureImage = document.createElement("img");
  picture.append(pictureSource, pictureImage);
  const controls = DCFContentTest.injectImageBookmarkControls(
    DCFContentTest.findPostBody()
  );
  const button = document.querySelector(".dcf-image-bookmark-button");
  const metadata = DCFContentTest.imageBookmarkMetadata(image);
  const checks = {
    oneControl: controls.length === 1,
    label: button?.textContent === "☆ 이미지 북마크",
    source:
      button?.dataset.sourceUrl ===
      "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=44",
    page: metadata?.pageUrl.endsWith("id=test_gallery&no=123"),
    title: metadata?.title === "테스트 본문 이미지",
    width: metadata?.width > 0,
    height: metadata?.height > 0,
    placement: image.nextElementSibling?.classList.contains(
      "dcf-image-bookmark-control"
    ),
    responsiveOriginal:
      DCFContentTest.imageBookmarkSource(responsive) ===
      "https://dcimg2.dcinside.co.kr/original.avif",
    linkedOriginal:
      DCFContentTest.imageBookmarkSource(linkedImage) ===
      "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=99",
    extensionlessLazyOriginal:
      DCFContentTest.imageBookmarkSource(lazyImage) ===
      "https://dcimg2.dcinside.co.kr/viewimage.php?id=test_gallery&no=100",
    pictureOriginal:
      DCFContentTest.imageBookmarkSource(pictureImage) ===
      "https://dcimg2.dcinside.co.kr/picture-large.avif"
  };
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(JSON.stringify(checks));
  }
  return true;
});

test("선택한 말머리만 보기에서 다른 일반 글만 숨김", () => {
  DCFContentTest.applySubjectFilter(document);
  return (
    !document.getElementById("anonymous-post").classList.contains("dcf-subject-filtered") &&
    document.getElementById("fixed-post").classList.contains("dcf-subject-filtered") &&
    !document.getElementById("semi-post").classList.contains("dcf-subject-filtered") &&
    !document.getElementById("notice-post").classList.contains("dcf-subject-filtered")
  );
});

test("선택한 말머리 숨기기에서 일치하는 일반 글만 숨김", () => {
  testState.subjectFiltersByGalleryKey["major:test_gallery"] = {
    ...testState.subjectFiltersByGalleryKey["major:test_gallery"],
    mode: "exclude",
    subjects: ["B"]
  };
  DCFContentTest.setStateForTest(testState);
  DCFContentTest.applySubjectFilter(document);
  return (
    !document.getElementById("anonymous-post").classList.contains("dcf-subject-filtered") &&
    document.getElementById("fixed-post").classList.contains("dcf-subject-filtered") &&
    !document.getElementById("notice-post").classList.contains("dcf-subject-filtered")
  );
});

test("전체 보기로 돌아가면 말머리로 숨긴 글을 모두 복원", () => {
  delete testState.subjectFiltersByGalleryKey["major:test_gallery"];
  DCFContentTest.setStateForTest(testState);
  DCFContentTest.applySubjectFilter(document);
  return DCFContentTest.collectPostRows().every(
    (row) => !row.classList.contains("dcf-subject-filtered")
  );
});

const list = document.getElementById("results");
for (const result of results) {
  const item = document.createElement("li");
  item.className = result.passed ? "pass" : "fail";
  item.textContent = result.passed
    ? `통과 — ${result.name}`
    : `실패 — ${result.name}: ${result.error}`;
  list.append(item);
}

const passedCount = results.filter((result) => result.passed).length;
const summary = document.getElementById("summary");
summary.id = "test-summary";
summary.dataset.passed = String(passedCount);
summary.dataset.total = String(results.length);
summary.className = passedCount === results.length ? "pass" : "fail";
summary.textContent = `${passedCount}/${results.length} 테스트 통과`;
