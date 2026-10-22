# AutoAPK — tiến độ chuyển toàn bộ chức năng

Trạng thái: ĐANG THỰC HIỆN. Không gọi bản tám mục trước là bản đầy đủ.

Source chuẩn: capture/action_request_engine.py hiện hành, 93 hàm action. Một số là alias/composite/helper, không tương đương 93 tác vụ độc lập.

Giữ game gốc và khóa ký test; build cài song song. User tự test điện thoại. Chưa release.

## Kế hoạch

- [x] Snapshot source APK hiện hành trước sửa
- [x] Inventory 93 hàm PC, 87 khối JS và 286 module native liên quan
- [x] Trích schema 2357 giao thức từ game nguồn hiện hành
- [ ] Runtime cấu hình / catalog / ngân sách / composite / Stop
- [ ] Nhóm tác vụ ngày, cửa hàng, xe, nghệ sĩ, phim, công hội
- [ ] Nhóm sự kiện, mini game và bộ giải
- [ ] Đối chiếu đủ 93 hàm, đánh dấu alias và các mục đã chuyển
- [ ] Menu cấu hình đầy đủ trên điện thoại
- [ ] Kiểm thử, build APK và kiểm tra mã nhúng
- [ ] Lưu source/handoff và bàn giao test

User đã đồng ý công khai source tại `lamdungcm/autotaphoa-update`, nhánh riêng `autoapk-full-20261022`, thư mục `autoapk/` (2026-10-22). Nhánh đã tạo. Không thay updater/release. user-context chỉ lưu ghi chú và đường dẫn source.

## Checkpoint hiện tại

- `FULL_PORT_COVERAGE.json`: 80/93 hàm đã nối mã, 84 mục APK, 13 hàm còn thiếu. Đây là coverage source, không phải xác nhận game thật.
- 133/133 kiểm tra JavaScript hiện có đạt; 39 kiểm tra mới tập trung runtime/config/transport, nhóm ngày, cây, nhân tài, tiệc/phim và xác nhận vật phẩm sự kiện.
- Đã có source menu cấu hình nhiều trang, chọn catalog và số lượng từng món. Chưa test UI cấu hình trên máy thật.
- `native_features.js`: 554 module native được đóng gói thành bản sao dùng transport riêng; cần tiếp tục test các manager/worker cụ thể.
- 19 worker sự kiện đã trích từ source PC. Handler nhiệm vụ hạn giờ đã được thay bằng bản strict riêng ở `ports_events_base.js`.
- Mới thêm BFS mê cung Cách Cách/Bạch Xà, các mini game dùng vật phẩm, nhóm thị trấn. Phần lớn nhóm này chưa có fixture test riêng.
- Đã bổ sung mỏ, tiệc khách sạn/sự kiện/Studio, hợp tác phim, Đá gà/Thương nhân phi pháp, Siêu giọng hát, đổi tem, nhân tài, cây, vườn trường, ánh sao, rùa, mùa thẻ, chợ đêm và nhóm mini game thị trấn. Một số nhóm mới chưa có fixture riêng; chưa kiểm chứng game thật.
- Chưa build APK mới cho full port. Bản tám chức năng trước vẫn được giữ nguyên.

### Việc tiếp theo

1. Hoàn thành 13 hàm còn thiếu trong coverage JSON (phim/tiệc, mỏ, cây, nhân tài, các sự kiện còn lại).
2. Tiếp tục kiểm tra và sửa worker PC có nhánh `ret == undefined`, tự gán hoàn thành hoặc fallback dựa trên việc chỉ gửi request. Transport đã chặn claim thiếu ID trả về, mua sai receipt và ngân sách shop không rõ.
3. Test business postconditions của các nhóm mới; test UI cấu hình/cancel/đổi nhân vật, strict full-coverage audit.
4. Build, đối chiếu toàn bộ mã nhúng ở bốn ABI, ký/alignment/manifest, đồng bộ bản test cho user tự test điện thoại.
5. Commit source lên nhánh đã duyệt và cập nhật pointer user-context.

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
