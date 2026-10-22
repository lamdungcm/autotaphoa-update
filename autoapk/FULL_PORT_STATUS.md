# AutoAPK — toàn bộ danh sách chức năng PC, bản test 22/10/2026

## Trạng thái

- Đã nối **93/93 hàm `action_*` PC hiện hành**, không còn hàm thiếu; menu có **96 mục**, gồm tác vụ con và nhóm/alias.
- **191/191 kiểm tra JavaScript + 22/22 kiểm tra đóng gói Python đạt.** Đây là test cục bộ, không phải xác nhận mọi sự kiện trên game thật.
- APK test đã build và ký bốn ABI, package `com.longca.taphoa.auto`, cùng khóa ký test với bản cài song song trước. Giữ nguyên APK tám mục.
- User chọn tự test trên điện thoại. Chưa xác nhận bản full trên ARM/Redmi, đăng nhập hoặc mọi chức năng game. Không release/updater/merge.
- Source được phép công khai ở `lamdungcm/autotaphoa-update`, nhánh `autoapk-full-20261022`, thư mục `autoapk/`. Checkpoint trước: `35c02d5094e220b70dd422789156848d80499009` (80/93); bản source đầy đủ thay checkpoint đó. Chỉ cập nhật nhánh source đã duyệt, không đổi main/updater.

## Artifact đã kiểm tra

- APK: `AutoTapHoa_AutoAPK_full_chuc_nang_test.apk`, 1130068031 byte, bốn ABI gồm ARM64.
- SHA-256: `3dccdb2d5a8450c3ab022b5c672b4f578240ed37a2b4b66a29d5d670a6466a03`.
- Chữ ký v1/v2 qua Android apksigner, kiểm tra v2 độc lập, cùng chứng thư với bản tám mục. CRC/căn chỉnh đạt; toàn bộ 32 nguồn nhúng trùng build; đọc registry từ chính payload trong APK thấy 96 mục/93 mapping.
- Source ZIP: `AutoAPK_source_full_20261022.zip`; không chứa khóa ký/đầu vào APK/dữ liệu tài khoản.

## Nội dung hoàn tất

- Cấu hình từng nhân vật, catalog thật, giới hạn mua/lượt, chọn nhóm, lưu/hủy và chặn lưu nhầm nhân vật.
- Stop/timeout/đổi tài khoản chặn request tiếp theo; request đã gửi phải đợi kết quả. Context tác vụ cũ không được dùng sang tác vụ mới; không báo thành công khi còn request chưa chờ.
- Tất cả nhóm PC: thư/thư ký, tiệm, tài năng/nghệ sĩ/xe, đào tạo, phim/tiệc, nông trại/thị trấn/công hội/mỏ và các sự kiện/mini game trong inventory bên dưới.
- Mùa Vụ: giữ nguyên luồng chọn ủy thác/ghép đội/xác nhận đang chạy; thêm quà miễn phí thực tế, nhiệm vụ/thành tựu, mốc đóng góp, chiến lệnh. Không gọi DONATE_DATA là thu hoạch hoặc coi đọc bảng xếp hạng là nhận thưởng.
- PHS chọn cụm thật trên bảng máy chủ; đầu tư dùng tuần/ngày và số cổ phiếu/tiền thực tế; Phối Heo dùng controller/vật lý thật, không tạo score/board giả.
- Sửa lỗi PC/native đã chứng minh: danh sách phim hợp tác đọc bằng `getMyArtwork(true)`, dailyHelpNum là lượt đã dùng, tên đội theo giới hạn native và tránh tạo đội trả phí, kiểu trận Ngưu Ma, bước Đỉnh Cao, số ô Quầy Tranh, thiệp Studio/đơn vị thời gian tiệc, tiền kim cương từ GoodsConfig.
- Worker kế thừa có giới hạn request mutation; Vạn Quốc bỏ oneKey tiêu toàn bộ năng lượng, không tự trừ năng lượng mặc định hoặc đoán bookId1..15. Võ Hậu bóc `resp` của fastpass để tránh gửi thêm trận thường. Nhổ Củ Cải không biến số lượt0 thành1 hoặc tăng ải khi ACK.

## Giới hạn cần test trực tiếp

- Bản này đạt coverage source. Các worker cũ chưa đều có fixture riêng cho mọi nhánh; giao thức/cấu hình hot update có thể làm tác vụ dừng với thông báo chưa xác nhận.
- Đỉnh Cao tự chơi Stage1 theo phạm vi PC; Stage2 không có bộ giải mới. Mùa Thẻ mở gói thường; gói chọn thẻ tùy ý vẫn chọn trong game.
- Phối Heo cần scene vật lý thật hoạt động; tạm dừng/chuyển giao diện sẽ dừng trước khi gửi kết quả tiếp.
- Vạn Quốc cần package runtime và cấu hình sổ tay thật. Thiếu cấu hình sẽ dừng, không thử ID bừa. Worker budget tính lệnh thao tác, không đồng nghĩa số lượt chơi/tổng vật phẩm.
- Cài song song có dữ liệu riêng; có thể tải lại tài nguyên và đăng nhập lại. Chưa kiểm chứng tương thích SDK trên điện thoại của user.
- Không đổi source PC, không xóa game gốc, không đưa APK/khóa ký/tài khoản/dump phiên lên repo public.

## Kiểm tra / tài liệu

`FULL_PORT_COVERAGE.json` là kết quả audit source. `src/bundle.json` là thứ tự mã nhúng thật. `evidence/full_port_20261022/` lưu test và build log cục bộ. `PUBLIC_SOURCE_POLICY.md` ghi phạm vi được công khai.

## Inventory PC

| Hàm | Dòng source | Module native tham chiếu |
|---|---:|---|
| action_claim_mail | 2886 |  |
| action_claim_individual_mails | 2891 | MailMgr, MailNetUtil |
| action_secretary | 3005 | AssistantMgr, AssistantNetUtil |
| action_secretary_double | 3138 |  |
| action_studio | 3149 |  |
| action_visit_like | 3264 | PlayerMgr |
| action_car_improve | 3679 | CarNetUtil |
| action_scan_vehicle_catalog | 3765 |  |
| action_training | 3795 |  |
| action_artist_gift | 3864 |  |
| action_artist_skill | 3879 |  |
| action_artist | 3909 |  |
| action_share_game | 3916 |  |
| action_billionaire_shop | 3960 |  |
| action_buy_shop_item | 4082 |  |
| action_quick_buy | 4134 |  |
| action_quick_buy_shop | 4190 |  |
| action_bi_kip_lam_giau | 4250 | ActivityBattlePassUtil, ActivityFundMgr, ActivityMgr, ActivityNetUtil, BattlePassMgr, BattlePassNetUtil, FundMgr, FundNetUtil, FundUtil |
| action_thao_lap_nhan_tai | 4464 | BuildingNetUtil |
| action_dap_anh | 4627 | BagMgr |
| action_nem_bao_cat | 4746 |  |
| action_phoi_heo_giong_request | 4805 |  |
| action_tay_du_ky | 4947 | ActivityMgr |
| action_nguu_ma_giang_the | 5310 | ActivityMgr |
| action_thien_nu_u_hon | 5607 |  |
| action_rua_cham_tran | 5636 |  |
| action_cach_cach_bo_tron | 5774 | ActivityMgr, CoupleMazeConfig, CoupleMazeMgr, EventMgr, GameNetMgr |
| action_bach_xa_truyen | 6567 | ActivityMgr, GameNetMgr |
| action_do_xe | 7237 | ActivityMgr, ActivityParkingWarsMgr, ActivityParkingWarsNetUtil, AutoShowMgr, AutoShowNetUtil, DBUtil, HeroMgr, PlayerMgr, UIMgr |
| action_mua_vu_ban_ron | 8371 |  |
| action_giao_thuong_dac_san | 8436 | ActivitySpecialtyMgr, ActivitySpecialtyNetUtil, BagMgr |
| action_so_han_tranh_ba | 8794 | ActivityChuHanContentionNetUtil |
| action_dinh_cao_thoi_gian | 8933 |  |
| action_quay_tranh_duong | 9116 | ActivityMgr, BagMgr, BagModel, ShopNetUtil |
| action_con_bao_dau_tu | 9600 | ActivityMgr, ActivityNetUtil, ActivityStockMarketMgr, ActivityStockMarketUtil, ActivityTaskUtil, ActivityWarOrderMgr, ActivityWarOrderNetUtil, TeamMgr, TeamNetUtil, UIMgr |
| action_dien_thoai_phs | 10120 |  |
| action_nho_cu_cai | 10459 | GameNetUtil, Protocol |
| action_tranh_doat_mo_khoang | 10636 |  |
| action_van_quoc_thong_thuong | 10755 | GameNetUtil, Protocol |
| action_choi_day | 11117 | BagNetUtil |
| action_nem_da | 11230 |  |
| action_da_ga | 11481 |  |
| action_thuong_nhan_phi_phap | 11659 |  |
| action_su_kien_daily | 11745 |  |
| action_lat_bai_quyet_thang | 11782 |  |
| action_tao_minh_tinh | 11854 | GameNetUtil, Protocol |
| action_game_vuon_truong | 12078 | ActivityCampusGamesNetUtil, ActivityMgr, ActivityNetUtil |
| action_than_bep_cho_dem | 12316 | BagMgr, NightMarketNetUtil |
| action_mo_the_mua | 12529 | ActivityGuardianCollectMgr, ActivityMgr, ActivityNetUtil |
| action_mini_game_thi_tran | 12751 |  |
| action_advisor_money | 12800 |  |
| action_daily_quick_claim | 12837 |  |
| action_daily_checkin | 12848 |  |
| action_nhan_qua_han_gio | 12877 |  |
| action_limited_quests | 12904 | ActivityConfig, ActivityMgr, ActivityNetUtil, ActivityTaskUtil, ActivityUtil, EventMgr |
| action_county_limited | 13156 | ActivityMgr, ShopMgr |
| action_shop_free_gift | 13258 | ActivityMgr, ShopMgr |
| action_film_legend | 13355 |  |
| action_guild_like | 13402 | GuildMgr, GuildNetUtil, PlayerMgr |
| action_mine_explore | 13569 |  |
| action_mo_cao_cap | 13765 | BagMgr, MineMgr, MineNetUtil, PlayerMgr |
| action_farm | 14307 | DBUtil, FarmMgr, FarmUtil, UIMgr |
| action_cinema_quiz | 14477 |  |
| action_fishing | 14592 | MainEventMgr, MainEventNetUtil |
| action_thau_phuong_trai | 14818 |  |
| action_hem_nua_dem | 14834 | GameNetUtil, Protocol |
| action_bat_trom | 14940 | MainEventMgr |
| action_nem_vong | 15030 | DBUtil, MainEventMgr |
| action_city_events | 15126 |  |
| action_water_tree | 15229 | BagMgr, GameNetUtil, Protocol, TaskMgr, TaskNetUtil, TaskUtil, TreePlantingMgr |
| action_phoi_heo_giong | 15631 |  |
| action_sieu_giong_hat | 15635 |  |
| action_mo_tiec_studio | 16122 |  |
| action_an_tiec_lien_server | 16229 | RestaurantMgr |
| action_doi_tem_lay_do | 16369 | BagMgr, GameNetUtil, Protocol |
| action_exp_cong_hoi_mua_manh_bua | 16472 | ActivityMgr, BagMgr, DBUtil, ShopMgr, ShopNetUtil |
| action_gieng_co_phat_sang | 16638 | BagMgr, GameNetUtil, Protocol |
| action_tranh_ba_hai_vuc | 16796 | BagMgr, GameNetUtil, Protocol |
| action_hop_tac_phim | 17269 |  |
| action_an_tiec_lsv | 17726 |  |
| action_an_tiec_su_kien | 18027 |  |
| action_an_tiec_tong_hop | 18037 |  |
| action_mo_tiec_khach_san | 18254 | BagMgr |
| action_den_hoa_cau_nguyen | 18505 | ActivityMgr, ActivityNetUtil, ActivityTaskUtil, ActivityTaskView1, ActivityWishingLanternGameView, ActivityWishingLanternMainView, ActivityWishingLanternMgr, ActivityWishingLanternNetUtil, ActivityWishingLanternRewardView, ActivityWishingLanternSelectRewardView, ActivityWishingLanternUtil, BagMgr, UIMgr |
| action_vo_lam_truyen_ky | 18805 | ActivityFengyunCopyBreakResultView, ActivityFengyunCopyMgr, ActivityFengyunCopyTowerFightResultView, ActivityFengyunCopyUIUtil, ActivityFengyunCopyUpLevelView, ActivityFengyunCopyUtil, ActivityMgr, ActivityNetUtil, ActivityTaskUtil, UIMgr |
| action_con_duong_anh_sao | 19623 | ActivityMgr, ActivityStarLightMgr, BagMgr, GameNetUtil, Protocol, ShopMgr, ShopNetUtil, UIMgr |
| action_nghe_thuat_dan_gian | 19827 | BagMgr, GameNetUtil, Protocol, UIMgr |
| action_di_tich_tu_linh | 19977 | GameNetUtil, Protocol, UIMgr |
| action_cong_vien_ki_thu | 20249 | GameNetUtil, Protocol, UIMgr |
| action_than_do_bat_da | 20460 | ActivityMgr, ActivityWuzetianConfig, ActivityWuzetianMgr, ActivityWuzetianNetUtil, ActivityWuzetianUtil, EventMgr |
| action_vo_hau_khai_quoc | 20764 | ActivityMgr, ActivityWuzetianMgr, ActivityWuzetianNetUtil, ActivityWuzetianUtil, BagMgr, GameNetUtil, Protocol, ShopMgr, ShopNetUtil, ToastConfirmView, UIMgr |
| action_the_gioi_dong_vat | 21315 | ActivityAnimalMigrationGameRewardView, ActivityAnimalMigrationMgr, ActivityAnimalMigrationNetUtil, ActivityMgr, GameNetUtil, Protocol, ShopMgr, ShopNetUtil, UIMgr |
| action_khoanh_khac_am_ap | 21878 | ActivityMgr, ActivityNetUtil, BagMgr, BagNetUtil, SkinRebateNetUtil, SkinRebateUtil, UIMgr |
