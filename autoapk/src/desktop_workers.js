/* Generated from current desktop source. See adjacent provenance JSON. */
(function(root){ "use strict"; var P=root.AutoAPK.port; P.workers={};
P.workers["do_xe"]={definition:{"id": "do_xe", "name": "Đỗ xe và triển lãm", "types": [1056, 2001], "action": "action_do_xe", "var": "start_worker_js", "result": "__doxe_task", "done": "done", "counters": ["parkedCount"]},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (() => {
            try {
                let req = (typeof window !== 'undefined' ? window : globalThis).__require;
                window.__doxe_task = {
                    running: true,
                    done: false,
                    error: null,
                    parkedCount: 0,
                    turnsLeft: 0,
                    newLogs: []
                };

                function addLog(msg) {
                    if (window.__doxe_task && window.__doxe_task.newLogs) {
                        window.__doxe_task.newLogs.push(msg);
                    }
                }

                (async () => {
                    try {
                        let asm = req('AutoShowMgr').AutoShowMgr.inst;
                        let asnu = req('AutoShowNetUtil').AutoShowNetUtil;
                        let apwm = req('ActivityParkingWarsMgr').ActivityParkingWarsMgr.inst;
                        let apwn = req('ActivityParkingWarsNetUtil').ActivityParkingWarsNetUtil;
                        let hm = req('HeroMgr').HeroMgr.inst;
                        let dbu = req('DBUtil').DBUtil;
                        let pm = req('PlayerMgr').PlayerMgr.inst;
                        let myUid = pm._model ? pm._model.userId : 0;
                        let actId = params.activityId;

                        // --- 1. TRIỂN LÃM XE (AUTOSHOW) ---
                        // Xác định chính xác xe đã đỗ trong Triển Lãm hay chưa (qua model, requestData và danh sách ghế)
                        let alreadyParked = false;
                        let asData = asm.model ? asm.model.getDataByActId(actId) : null;
                        if (asData && asData.myData && asData.myData.rank && asData.myData.rank > 0) {
                            alreadyParked = true;
                        }

                        // Đồng bộ dữ liệu cá nhân triển lãm từ máy chủ (S_CARWAR_DATA)
                        let reqDataRes = await new Promise((resolve) => {
                            try {
                                if (asnu && typeof asnu.requestData === 'function') {
                                    asnu.requestData(actId, (res) => resolve(res));
                                } else if (asm && typeof asm.requestData === 'function') {
                                    asm.requestData(actId, (res) => resolve(res));
                                } else {
                                    resolve(null);
                                }
                            } catch(eReq) { resolve(null); }
                            setTimeout(() => resolve(null), 2000);
                        });

                        asData = asm.model ? asm.model.getDataByActId(actId) : null;
                        if (asData && asData.myData && asData.myData.rank && asData.myData.rank > 0) {
                            alreadyParked = true;
                        }
                        if (!alreadyParked && reqDataRes && reqDataRes.showData && reqDataRes.showData.rank && reqDataRes.showData.rank > 0) {
                            alreadyParked = true;
                        }

                        if (alreadyParked) {
                            // Đã đỗ rồi -> BỎ QUA KHÔNG ĐỖ TIẾP VÀ HOÀN TOÀN KHÔNG IN LOG
                            try {
                                await new Promise((resolve) => {
                                    asnu.requestReward(actId, (res) => resolve(res));
                                    setTimeout(resolve, 1000);
                                });
                            } catch(eRw) {}
                        } else {
                            // Chỉ khi chưa xác định đỗ mới tải danh sách ghế để kiểm tra lại và tìm chỗ trống
                            let showInfoRes = await new Promise((resolve) => {
                                asnu.requestAutoShowInfo(actId, 1, 600, (res) => resolve(res));
                                setTimeout(() => resolve(null), 2500);
                            });

                            let showList = (showInfoRes && showInfoRes.showData) ? showInfoRes.showData : ((asData && asData.seatDataList) ? asData.seatDataList : []);
                            if (asData && showList.length > 0 && typeof asData.syncSeatDataList === 'function') {
                                try { asData.syncSeatDataList(showList); } catch(eSync) {}
                            }

                            let mySeatInList = showList.find(s => {
                                let uId = (s.playerData && s.playerData.userId) ? s.playerData.userId : (s.playerId || 0);
                                return uId && myUid && (uId === myUid);
                            });

                            if (mySeatInList && mySeatInList.rank > 0) {
                                // Đã có xe đỗ trong danh sách ghế -> Bỏ qua, không in log
                                try {
                                    await new Promise((resolve) => {
                                        asnu.requestReward(actId, (res) => resolve(res));
                                        setTimeout(resolve, 1000);
                                    });
                                } catch(eRw) {}
                            } else {
                                // Chưa có xe đỗ -> Tìm chỗ trống để đỗ
                                let emptySeat = showList.find(s => (!s.playerId || s.playerId === 0) && !s.playerData);
                                if (emptySeat && emptySeat.rank) {
                                    await new Promise((resolve) => {
                                        asnu.requestBattle(actId, emptySeat.rank, (res) => {
                                            try { asnu.requestReward(actId); } catch(eR) {}
                                            resolve(res);
                                        });
                                        setTimeout(resolve, 2000);
                                    });
                                    addLog("[Đỗ Xe] Đỗ xe thành công vào Triển Lãm (Hạng " + emptySeat.rank + ").");
                                }
                            }
                        }

                        // --- 2. BÃI ĐỖ XE CỦA TÔI ---
                        addLog("[Đỗ Xe] 🅿️ Đang kiểm tra Bãi đỗ xe của tôi...");
                        await new Promise((resolve) => {
                            apwn.requestCarWarMeLotDetailReqMsg({ activityId: actId }, (res) => { resolve(res); });
                            setTimeout(resolve, 2000);
                        });

                        let meLot = (apwm.model && apwm.model.CarWarMeLotDetailRespMsg) ? apwm.model.CarWarMeLotDetailRespMsg.lots : null;
                        if (!meLot || !meLot.showCarId || meLot.showCarId === 0) {
                            addLog("[Đỗ Xe] Đang đỗ xe vào Bãi đỗ xe của tôi...");
                            await new Promise((resolve) => {
                                apwn.requestCarWarStopReqMsg({ activityId: actId }, (res) => { resolve(res); });
                                setTimeout(resolve, 1500);
                            });
                            addLog("[Đỗ Xe] Đỗ xe vào bãi cá nhân thành công.");
                            meLot = (apwm.model && apwm.model.CarWarMeLotDetailRespMsg) ? apwm.model.CarWarMeLotDetailRespMsg.lots : null;
                        }
                        if (meLot && ((meLot.earning1 && meLot.earning1 > 0) || (meLot.earning2 && meLot.earning2 > 0))) {
                            addLog("[Đỗ Xe] Đang thu tiền bãi đỗ xe (" + (meLot.earning1 || 0) + " vàng)...");
                            await new Promise((resolve) => {
                                apwn.requestCarWarParkingLotRewardReqMsg({ activityId: actId }, (res) => { resolve(res); });
                                setTimeout(resolve, 1500);
                            });
                            addLog("[Đỗ Xe] Thu tiền bãi xe thành công.");
                        }

                        // --- 3. ĐỖ TỐI ĐA 4 LƯỢT VÀO BÃI NGƯỜI KHÁC ---
                        await new Promise((resolve) => {
                            apwn.requestCarWarDataReqMsg({ activityId: actId }, (res) => { resolve(res); });
                            setTimeout(resolve, 1500);
                        });

                        let cwData = apwm.model ? apwm.model.CarWarDataRespMsg : null;
                        let turns = (cwData && cwData.data && typeof cwData.data.park === 'number') ? cwData.data.park : 4;
                        let maxParksToAttempt = Math.min(Math.max(0, turns), 4);
                        window.__doxe_task.turnsLeft = turns;

                        if (turns <= 0) {
                            addLog("[Đỗ Xe] Đã hết lượt đỗ xe hôm nay (còn 0 lượt).");
                        } else {
                            addLog("[Đỗ Xe] Bắt đầu tìm bãi đỗ xe khác (Còn " + turns + " lượt, tối đa đỗ " + maxParksToAttempt + " xe)...");
                        }

                        let usedHeroIds = new Set();
                        let alreadyUp = (typeof apwm.getUpHerolist === 'function' ? apwm.getUpHerolist() : []) || [];
                        alreadyUp.forEach(id => usedHeroIds.add(parseInt(id)));

                        function getHeroesForSlot(slotIndex) {
                            let allIds = (typeof hm.getOwnHeroIdList === 'function' ? hm.getOwnHeroIdList() : []) || [];
                            let candidates = [];
                            for (let id of allIds) {
                                let numId = parseInt(id);
                                if (usedHeroIds.has(numId) || usedHeroIds.has(id)) continue;
                                let staticH = dbu ? dbu.getHero(id) : null;
                                let d = hm ? hm.getHeroData(id) : null;
                                let occ = staticH ? staticH.occupation : 0;
                                if (occ === slotIndex) {
                                    let ability = d ? (d.ability || parseInt(d.sumAbility || 0)) : 0;
                                    candidates.push({ id: numId, occ: occ, ability: ability });
                                }
                            }
                            candidates.sort((a, b) => b.ability - a.ability);
                            if (candidates.length < 5) return null;
                            return candidates.slice(0, 5).map(c => c.id);
                        }

                        let pageStart = 100;
                        let maxRank = 350;
                        let consecutiveErrors = 0;
                        let lotsChecked = 0;

                        while (window.__doxe_task.parkedCount < maxParksToAttempt && turns > 0 && pageStart <= maxRank && consecutiveErrors < 6) {
                            let pageEnd = Math.min(pageStart + 9, maxRank);
                            let lotResp = await apwn.sendCarWarParkingLotReqMsg(actId, pageStart, pageEnd);
                            let lots = (lotResp && lotResp.lots) ? lotResp.lots : [];
                            if (!lots || lots.length === 0) {
                                pageStart += 10;
                                continue;
                            }

                            for (let lot of lots) {
                                if (window.__doxe_task.parkedCount >= maxParksToAttempt || turns <= 0) break;
                                let ownerUid = lot.playerData ? lot.playerData.userId : 0;
                                if (!ownerUid || ownerUid === myUid) continue;

                                lotsChecked++;
                                if (lotsChecked > 120) {
                                    addLog("[Đỗ Xe] Đã kiểm tra 120 bãi xe lân cận. Dừng quét.");
                                    turns = 0;
                                    break;
                                }

                                let stops = lot.stops || [];
                                // Bỏ qua nếu bãi đã kín đủ 4 xe
                                if (stops.length >= 4) continue;
                                // Bỏ qua nếu mình đã đỗ ở bãi này
                                if (stops.some(s => s.playerId === myUid)) continue;

                                // Lấy chi tiết bãi trước khi phái xe để đồng bộ trạng thái server
                                let detailResp = await apwn.sendCarWarLotDetailReqMsg(actId, lot.rank, null);
                                if (detailResp && detailResp.ret === 0) {
                                    try { apwm.asynCarWarLotDetailRespMsg(detailResp); } catch(eDetail) {}
                                }

                                let occupiedIndices = stops.map(s => s.index);
                                for (let idx = 1; idx <= 4; idx++) {
                                    if (window.__doxe_task.parkedCount >= maxParksToAttempt || turns <= 0) break;
                                    if (!occupiedIndices.includes(idx)) {
                                        let heroes = getHeroesForSlot(idx);
                                        if (!heroes) continue;

                                        let robRes = await apwn.sendCarWarRobBattleReqMsg(actId, ownerUid, idx, heroes);

                                        if (robRes && robRes.ret === 0) {
                                            consecutiveErrors = 0;
                                            window.__doxe_task.parkedCount++;
                                            heroes.forEach(hId => usedHeroIds.add(hId));
                                            if (robRes.data && typeof robRes.data.park === 'number') {
                                                turns = robRes.data.park;
                                            } else {
                                                turns = Math.max(0, turns - 1);
                                            }
                                            window.__doxe_task.turnsLeft = turns;
                                            let ownerName = lot.playerData ? lot.playerData.nickName : ('Hạng ' + lot.rank);
                                            addLog("[Đỗ Xe] Đỗ thành công vào bãi của " + ownerName + " (Vị trí " + idx + "). Đã đỗ: " + window.__doxe_task.parkedCount + "/" + maxParksToAttempt + " xe (còn " + turns + " lượt).");
                                            occupiedIndices.push(idx);
                                            stops.push({ playerId: myUid, index: idx });
                                            break;
                                        } else {
                                            let retCode = robRes ? robRes.ret : -1;
                                            if (retCode === 8797 || retCode === 8799) {
                                                addLog("[Đỗ Xe] Máy chủ thông báo đã hết lượt đỗ xe (Mã " + retCode + ").");
                                                turns = 0;
                                                break;
                                            }
                                            if (retCode === 8798) {
                                                heroes.forEach(hId => usedHeroIds.add(hId));
                                            }
                                            consecutiveErrors++;
                                            if (consecutiveErrors >= 6) {
                                                addLog("[Đỗ Xe] Đã dừng quét sau các lượt thử không thành công.");
                                                turns = 0;
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            pageStart += 10;
                        }

                        // --- 4. ĐÓNG CÁC POPUP NẾU CÓ ---
                        let ui = req('UIMgr').UIMgr.inst;
                        if (ui && ui._viewDict) {
                            for (let k in ui._viewDict) {
                                let v = ui._viewDict[k];
                                if (v && v.cacheClassName && (
                                    v.cacheClassName.includes('Parking') ||
                                    v.cacheClassName.includes('AutoShow') ||
                                    v.cacheClassName.includes('Reward')
                                )) {
                                    try { v.closeSelf ? v.closeSelf() : ui.closeView(v.cacheUuid); } catch(eClose) {}
                                }
                            }
                        }

                        window.__doxe_task.done = true;
                    } catch(eAsync) {
                        window.__doxe_task.error = String(eAsync);
                        window.__doxe_task.done = true;
                    }
                })();

                return JSON.stringify({ ok: true });
            } catch(e) {
                return JSON.stringify({ ok: false, error: String(e) });
            }
        })();
}};
P.workers["giao_thuong_dac_san"]={definition:{"id": "giao_thuong_dac_san", "name": "Giao thương đặc sản", "types": [1023, 23], "action": "action_giao_thuong_dac_san", "var": "js_flow", "result": "__gtdsExec", "counters": ["soldTotal", "boughtTotal", "gainedMilestones", "dispatched"]},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (() => {
                    let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                    g.__gtdsExec = null;
                    (async () => {
                        try {
                            let req = g.__require || (typeof __require !== 'undefined' ? __require : null);
                            if (!req) {
                                g.__gtdsExec = { ok: false, err: 'NO_REQUIRE' };
                                return;
                            }
                            let smMod = req('ActivitySpecialtyMgr');
                            let sm = smMod ? (smMod.ActivitySpecialtyMgr ? (smMod.ActivitySpecialtyMgr.inst || smMod.ActivitySpecialtyMgr._instance) : (smMod.inst || smMod._instance)) : null;
                            let netMod = req('ActivitySpecialtyNetUtil');
                            let net = netMod ? (netMod.ActivitySpecialtyNetUtil || netMod) : null;
                            if (!sm || !net) {
                                g.__gtdsExec = { ok: false, err: 'NO_MGR_OR_NET' };
                                return;
                            }

                            let actId = params.activityId;
                            let data = sm._model ? sm._model.getSpecialtyData(actId) : null;
                            if (!data) {
                                g.__gtdsExec = { ok: false, err: 'NO_DATA' };
                                return;
                            }

                            // Đồng bộ thông tin người chơi và 16 thành phố trực tiếp qua NetUtil
                            let infoRes = await net.getInfo(actId);
                            if (infoRes && infoRes.ret === 0) {
                                if (infoRes.info) data.playerData.syncInfo(infoRes.info);
                                if (infoRes.report) data.syncReport(infoRes.report);
                            }
                            let cityIds = data.getCityIdList ? data.getCityIdList() : [];
                            if (cityIds.length > 0) {
                                let cRes = await net.getCity(actId, cityIds);
                                if (cRes && cRes.ret === 0 && cRes.city) {
                                    cRes.city.forEach(c => data.syncCity(c));
                                }
                            }

                            let pd = data.playerData;
                            let curCityId = pd.cityId;
                            let curCityName = data.getCityName(curCityId) || 'Thành phố';
                            let curTransport = pd.getCurTransport();
                            let ownMoney = Number(pd.ownMoney || 0);
                            let logList = [];
                            let soldTotal = 0;
                            let boughtTotal = 0;

                            // Trạng thái A: Xe tiêu đang di chuyển
                            if (curTransport) {
                                // Thử dùng đạo cụ tăng tốc (120031) nếu trong túi còn
                                try {
                                    let bagMod = req('BagMgr');
                                    let bag = bagMod ? (bagMod.BagMgr ? bagMod.BagMgr.inst.model : bagMod.inst.model) : null;
                                    let speedItemCnt = bag && bag.getItemCount ? bag.getItemCount(120031) : 0;
                                    if (speedItemCnt > 0) {
                                        let spRes = await net.speedUp(actId, speedItemCnt);
                                        if (spRes && spRes.ret === 0) {
                                            logList.push(`Đã dùng ${speedItemCnt} vé tăng tốc xe tiêu`);
                                            curTransport = pd.getCurTransport();
                                        }
                                    }
                                } catch(eSp) {}

                                if (curTransport) {
                                    let remSec = Math.max(0, Math.floor(((curTransport.moveReachTime || 0) - Date.now()) / 1000));
                                    let remMin = Math.ceil(remSec / 60);
                                    let targetName = data.getCityName(curTransport.endCityId) || 'Đích';
                                    let goodsInfo = (pd.getGoodsList() || []).map(g => `${g.num} ${data.getGoodsName(g.goodsId) || 'Hàng'}`).join(', ');
                                    g.__gtdsExec = {
                                        ok: true,
                                        moving: true,
                                        targetName: String(targetName),
                                        remMin: Number(remMin),
                                        goodsInfo: String(goodsInfo),
                                        logs: logList
                                    };
                                    return;
                                }
                            }

                            // Trạng thái B: Bán hàng đang có trong túi tại thành phố hiện tại
                            let curGoodsList = pd.getGoodsList() || [];
                            for (let it of curGoodsList) {
                                if (it && it.num > 0) {
                                    let itName = data.getGoodsName(it.goodsId) || 'Hàng hóa';
                                    let sRes = await net.trade(actId, false, it.goodsId, String(it.num));
                                    if (sRes && sRes.ret === 0) {
                                        if (sRes.info) {
                                            pd.syncInfo(sRes.info);
                                            ownMoney = Number(sRes.info.holdFund || pd.ownMoney || 0);
                                        }
                                        soldTotal += it.num;
                                        logList.push(`Đã bán ${it.num} ${itName} tại ${curCityName}`);
                                    }
                                }
                            }

                            // Tự động kiểm tra và báo cáo tình báo thành phố nếu chưa ai báo cáo
                            let curCityData = data.getCityData(curCityId);
                            if (curCityData && !curCityData.reported) {
                                try {
                                    let repRes = await net.report(actId, curCityId);
                                    if (repRes && repRes.ret === 0) {
                                        logList.push(`Đã báo cáo tình báo cho ${curCityName}`);
                                    }
                                } catch(eRep) {}
                            }

                            // Nhận các mốc tình báo/giao thương đã đạt
                            let reportTasks = data.getReportTaskList ? data.getReportTaskList() : [];
                            let gainedMilestones = 0;
                            for (let t of reportTasks) {
                                if (t && t.curNum >= t.needNum && !t.isRewarded) {
                                    let repRes = await net.gainReport(actId, t.needNum);
                                    if (repRes && repRes.ret === 0) {
                                        gainedMilestones++;
                                        logList.push(`Đã nhận thưởng mốc giao thương (${t.needNum} đơn)`);
                                    }
                                }
                            }

                            // Trạng thái C: Mua hàng thông minh theo tỷ suất lợi nhuận cao nhất
                            ownMoney = Number(pd.ownMoney || 0);
                            let allCityIds = data.getCityIdList ? data.getCityIdList() : [];
                            let otherCityIds = allCityIds.filter(id => id !== curCityId);
                            let curCityGoods = curCityData ? curCityData.getGoodsList() : [];

                            let candidates = [];
                            for (let gItem of curCityGoods) {
                                if (!gItem || gItem.num <= 0) continue;
                                let buyPrice = gItem.price;
                                let maxSell = 0;
                                for (let cId of otherCityIds) {
                                    let oc = data.getCityData(cId);
                                    if (!oc) continue;
                                    let og = (oc.getGoodsList() || []).find(x => x.goodsId === gItem.goodsId);
                                    if (og && og.price > maxSell) {
                                        maxSell = og.price;
                                    }
                                }
                                let profit = maxSell - buyPrice;
                                let profitRate = (profit / buyPrice) * 100;
                                if (profit > 0) {
                                    candidates.push({
                                        goodsId: gItem.goodsId,
                                        name: data.getGoodsName(gItem.goodsId) || 'Hàng',
                                        buyPrice: buyPrice,
                                        stock: gItem.num,
                                        maxSell: maxSell,
                                        profit: profit,
                                        profitRate: profitRate
                                    });
                                }
                            }

                            // Sắp xếp giảm dần theo tỷ suất lợi nhuận
                            candidates.sort((a, b) => b.profitRate - a.profitRate);

                            // Phân bổ tiền: Ưu tiên ứng viên tốt nhất, còn vốn mua tiếp ứng viên sau
                            let toBuy = [];
                            let remMoney = ownMoney;

                            for (let c of candidates) {
                                if (remMoney < c.buyPrice) continue;
                                let canBuy = Math.floor(remMoney / c.buyPrice);
                                let qty = Math.min(c.stock, canBuy);
                                if (qty > 0) {
                                    toBuy.push({
                                        goodsId: c.goodsId,
                                        name: c.name,
                                        qty: qty,
                                        buyPrice: c.buyPrice,
                                        stock: c.stock,
                                        profitRate: c.profitRate.toFixed(1)
                                    });
                                    remMoney -= qty * c.buyPrice;
                                }
                            }

                            // Thực hiện lệnh mua hàng
                            for (let b of toBuy) {
                                let bRes = await net.trade(actId, true, b.goodsId, String(b.qty));
                                if (bRes && bRes.ret === 0) {
                                    if (bRes.info) {
                                        pd.syncInfo(bRes.info);
                                        ownMoney = Number(bRes.info.holdFund || pd.ownMoney || 0);
                                    }
                                    boughtTotal += b.qty;
                                    logList.push(`Đã mua ${b.qty} ${b.name} (giá ${b.buyPrice}, lãi dự kiến +${b.profitRate}%)`);
                                }
                            }

                            // Trạng thái D: Chọn thành phố đích có tổng lợi nhuận cao nhất và xuất phát
                            let bestDestCityId = 0;
                            let bestDestCityName = '';
                            let maxTotalProfit = -999999;

                            for (let cId of otherCityIds) {
                                let oc = data.getCityData(cId);
                                if (!oc) continue;
                                let totalProfit = 0;
                                for (let b of toBuy) {
                                    let og = (oc.getGoodsList() || []).find(x => x.goodsId === b.goodsId);
                                    if (og) {
                                        totalProfit += (og.price - b.buyPrice) * b.qty;
                                    }
                                }
                                if (totalProfit > maxTotalProfit) {
                                    maxTotalProfit = totalProfit;
                                    bestDestCityId = cId;
                                    bestDestCityName = data.getCityName(cId) || 'Thành phố';
                                }
                            }

                            if (bestDestCityId === 0 && otherCityIds.length > 0) {
                                bestDestCityId = otherCityIds[0];
                                bestDestCityName = data.getCityName(bestDestCityId) || 'Thành phố';
                            }

                            let dispatched = false;
                            let currentGoodsAfterTrade = pd.getGoodsList() || [];
                            if (bestDestCityId > 0 && (toBuy.length > 0 || currentGoodsAfterTrade.length > 0 || candidates.length === 0)) {
                                let mRes = await net.move(actId, bestDestCityId);
                                if (mRes && mRes.ret === 0) {
                                    if (mRes.info) { pd.syncInfo(mRes.info); }
                                    dispatched = true;
                                    if (maxTotalProfit > 0) {
                                        logList.push(`Đã xuất phát xe tiêu đến ${bestDestCityName} (dự kiến lãi +${maxTotalProfit} bạc)`);
                                    } else {
                                        logList.push(`Đã di chuyển xe tiêu sang ${bestDestCityName}`);
                                    }
                                }
                            }

                            if (soldTotal === 0 && boughtTotal === 0 && !dispatched && logList.length === 0) {
                                logList.push(`Thành phố ${curCityName} hiện chưa có hàng hóa sinh lời mới, vốn hiện có ${ownMoney} bạc`);
                            }

                            g.__gtdsExec = {
                                ok: true,
                                moving: false,
                                soldTotal: Number(soldTotal),
                                boughtTotal: Number(boughtTotal),
                                gainedMilestones: Number(gainedMilestones),
                                dispatched: Boolean(dispatched),
                                bestDestCityName: String(bestDestCityName),
                                logs: logList
                            };
                        } catch(err) {
                            g.__gtdsExec = { ok: false, err: String(err) };
                        }
                    })();
                    return 'STARTED';
                })();
}};
P.workers["so_han_tranh_ba"]={definition:{"id": "so_han_tranh_ba", "name": "Sở Hán tranh bá", "types": [1077], "action": "action_so_han_tranh_ba", "var": "js_chuhan", "result": "__soHanExec", "counters": []},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (() => {
                    let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                    g.__soHanExec = null;
                    (async () => {
                        try {
                            let req = g.__require || (typeof __require !== 'undefined' ? __require : null);
                            if (!req) {
                                g.__soHanExec = { err: 'NO_REQUIRE' };
                                return;
                            }
                            let netMod = req('ActivityChuHanContentionNetUtil');
                            let net = netMod ? (netMod.ActivityChuHanContentionNetUtil || netMod) : null;
                            if (!net) {
                                g.__soHanExec = { err: 'NO_NET' };
                                return;
                            }

                            let actId = params.activityId;
                            let logList = [];

                            // a. Phúc lợi quân doanh phe
                            try {
                                let r1 = await net.getCampWelfareReward(actId);
                                if (r1 && r1.ret === 0) logList.push('Đã nhận phúc lợi quân doanh phe');
                            } catch(e1) {}

                            // b. Thu hồi thương binh hồi phục từ bệnh viện
                            try {
                                let r2 = await net.requestGainSoldiersHospital(actId);
                                if (r2 && r2.ret === 0) logList.push('Đã thu hồi thương binh xuất viện');
                            } catch(e2) {}

                            // c. Thu hoạch tài nguyên quân nhu
                            try {
                                let r3 = await net.getChuHanLevy(actId);
                                if (r3 && r3.ret === 0) logList.push('Đã thu hoạch tài nguyên quân nhu');
                            } catch(e3) {}

                            // d. Tuyển mộ binh lính nếu có lượt
                            try {
                                let r4 = await net.requestConscription(actId);
                                if (r4 && r4.ret === 0) logList.push('Đã tuyển mộ thêm binh lính');
                            } catch(e4) {}

                            // e. Thưởng vinh dự các cấp (1..5)
                            for (let lvl = 1; lvl <= 5; lvl++) {
                                try {
                                    let rH = await net.getHonorReward(actId, lvl);
                                    if (rH && rH.ret === 0) logList.push(`Đã nhận thưởng vinh dự cấp ${lvl}`);
                                } catch(eH) {}
                            }

                            g.__soHanExec = { ok: true, logs: logList };
                        } catch(err) {
                            g.__soHanExec = { err: String(err) };
                        }
                    })();
                    return 'STARTED';
                })();
}};
P.workers["nho_cu_cai"]={definition:{"id": "nho_cu_cai", "name": "Nhổ củ cải", "types": [1035], "action": "action_nho_cu_cai", "var": "js_flow", "result": "__carrotRes", "error": "__carrotErr", "counters": ["turnsDone", "levelsCleared"], "limit": 150},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (() => {
                        let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                        let req = g.__require || (typeof __require !== 'undefined' ? __require : null);
                        if (!req) return 'NO_REQUIRE';
                        let proto = req('Protocol');
                        if (proto && proto.Protocol) proto = proto.Protocol;
                        let gnu = req('GameNetUtil');
                        if (gnu && gnu.GameNetUtil) gnu = gnu.GameNetUtil;
                        if (gnu && gnu.getInstance) gnu = gnu.getInstance();
                        if (!gnu || !proto) return 'NO_GNU';

                        let actId = params.activityId;
                        let maxP = params.limit;
                        g.__carrotRes = null;
                        g.__carrotErr = null;

                        (async () => {
                            let summary = { turnsDone: 0, levelsCleared: 0, stopReason: '' };
                            try {
                                for (let i = 0; i < maxP; i++) {
                                    let res = await gnu.syncSeqSendMsg(proto.S_PLUCK_CARROTS_PLUCK, { activityId: actId, times: 1 });
                                    if (!res) {
                                        summary.stopReason = 'no_response';
                                        break;
                                    }
                                    if (res.ret !== 0 && res.ret !== undefined) {
                                        summary.stopReason = 'ret_' + res.ret;
                                        break;
                                    }
                                    summary.turnsDone += (res.actuallyPluckTimes || 1);

                                    let reportList = res.reportList || [];
                                    if (reportList.some(r => r && r.pass)) {
                                        await gnu.syncSeqSendMsg(proto.S_PLUCK_CARROTS_NEXT_LEVEL, { activityId: actId });
                                        summary.levelsCleared++;
                                    }
                                }
                                g.__carrotRes = summary;
                            } catch(err) {
                                g.__carrotErr = String(err);
                            }
                        })();
                        return 'STARTED';
                    })();
}};
P.workers["van_quoc_thong_thuong"]={definition:{"id": "van_quoc_thong_thuong", "name": "Vạn quốc thông thương", "types": [1090], "action": "action_van_quoc_thong_thuong", "var": "js_flow", "result": "__vqRes", "error": "__vqErr", "counters": ["tradesDone", "seaDone", "expandsDone", "upgradesDone", "booksClaimed"], "limit": 150},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (() => {
                    let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                    let req = g.__require || (typeof __require !== 'undefined' ? __require : null);
                    if (!req) return 'NO_REQUIRE';
                    let gnu = req('GameNetUtil');
                    if (gnu && gnu.GameNetUtil) gnu = gnu.GameNetUtil;
                    let proto = req('Protocol');
                    if (proto && proto.Protocol) proto = proto.Protocol;
                    if (!gnu || !proto) return 'NO_NET_OR_PROTO';

                    let actId = params.activityId;
                    g.__vqRes = null;
                    g.__vqErr = null;

                    (async () => {
                        let summary = {
                            tradesDone: 0,
                            seaDone: 0,
                            upgradesDone: 0,
                            expandsDone: 0,
                            booksClaimed: 0
                        };
                        try {
                            // a. Lấy thông tin ban đầu
                            let info = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_INFO, { activityId: actId });
                            if (!info || info.ret !== 0) {
                                g.__vqErr = 'Lỗi lấy info: ' + (info ? info.ret : 'null');
                                return;
                            }

                            // b. Thử hồi phục thể lực nếu có
                            try {
                                let rec = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_RECOVER_ENERGY, { activityId: actId, count: 1 });
                                if (rec && rec.ret === 0 && rec.energy !== undefined) info.energy = rec.energy;
                            } catch(e) {}

                            // c. Giao thương tiêu hao toàn bộ thể lực
                            let curEnergy = info.energy || 0;
                            if (curEnergy > 0) {
                                // Thử 1-chạm toàn bộ (oneKey: true) trước
                                let costOneKey = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_COST_ENERGY, { activityId: actId, oneKey: true });
                                if (costOneKey && costOneKey.ret === 0) {
                                    let remEnergy = (costOneKey.energy !== undefined) ? costOneKey.energy : 0;
                                    summary.tradesDone = Math.max(1, curEnergy - remEnergy);
                                    curEnergy = remEnergy;
                                } else {
                                    // Fallback: Với tài khoản chưa mở khóa "Tiếp Đón Nhanh" (oneKey trả 20002), lặp từng lượt đơn (oneKey: false)
                                    for (let i = 0; i < 60 && curEnergy > 0; i++) {
                                        let c = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_COST_ENERGY, { activityId: actId, oneKey: false });
                                        if (c && c.ret === 0) {
                                            summary.tradesDone++;
                                            curEnergy = (c.energy !== undefined) ? c.energy : (curEnergy - 1);
                                        } else {
                                            // Hết khách thì làm mới khách để nạp đợt khách mới
                                            await gnu.syncSeqSendMsg(proto.S_THIRTEEN_REFRESH_CUSTOMER, { activityId: actId, needRemoveCustomer: false });
                                            let c2 = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_COST_ENERGY, { activityId: actId, oneKey: false });
                                            if (c2 && c2.ret === 0) {
                                                summary.tradesDone++;
                                                curEnergy = (c2.energy !== undefined) ? c2.energy : (curEnergy - 1);
                                            } else {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }

                            // d & e. Chu kỳ: Sau khi gửi hết yêu cầu dùng hết lượt thì gửi đơn hàng (Thuyền buôn ra khơi)
                            for (let cycle = 0; cycle < 15; cycle++) {
                                let reqCount = 0;
                                // 1. Gửi hết yêu cầu của khách hàng trong lượt (tối đa 8 lần mỗi đợt)
                                for (let r = 0; r < 8; r++) {
                                    let ref = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_REFRESH_CUSTOMER, { activityId: actId, needRemoveCustomer: false });
                                    if (ref && ref.ret === 0) {
                                        summary.tradesDone++;
                                        reqCount++;
                                    } else {
                                        break;
                                    }
                                }
                                // 2. Sau khi gửi hết yêu cầu dùng hết lượt thì gửi đơn hàng
                                let sea = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_SEA, { activityId: actId });
                                if (sea && sea.ret === 0) {
                                    summary.seaDone++;
                                } else {
                                    if (reqCount === 0) {
                                        break;
                                    }
                                }
                            }

                            // f. Lấy lại danh sách phòng và số lượng vật phẩm nâng cấp
                            let info2 = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_INFO, { activityId: actId });
                            let settings = (info2 && info2.setting) || info.setting || [];

                            // Mở rộng gian hàng
                            for (let s of settings) {
                                if (!s || !s.id || s.id === 10001) continue;
                                try {
                                    let expRes = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_EXPAND_SETTING, { activityId: actId, settingId: s.id });
                                    if (expRes && expRes.ret === 0) summary.expandsDone++;
                                } catch(e) {}
                            }

                            // Nâng cấp các phòng cho đến khi hết tài nguyên hoặc kịch cấp
                            for (let pass = 0; pass < 8; pass++) {
                                let hadUp = false;
                                for (let s of settings) {
                                    if (!s || !s.id || s.id === 10001) continue;
                                    let u5 = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_UPGRADE_SETTING, { activityId: actId, settingId: s.id, times: 5 });
                                    if (u5 && u5.ret === 0) {
                                        summary.upgradesDone += 5;
                                        hadUp = true;
                                    } else {
                                        let u1 = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_UPGRADE_SETTING, { activityId: actId, settingId: s.id, times: 1 });
                                        if (u1 && u1.ret === 0) {
                                            summary.upgradesDone += 1;
                                            hadUp = true;
                                        }
                                    }
                                }
                                if (!hadUp) break;
                            }

                            // g. Nhận thưởng sổ tay đồ giám (bookId 1..15)
                            let gained = (info2 && info2.gainedBookId) || [];
                            for (let bId = 1; bId <= 15; bId++) {
                                if (gained.includes(bId)) continue;
                                try {
                                    let bk = await gnu.syncSeqSendMsg(proto.S_THIRTEEN_GET_BOOK_REWARD, { activityId: actId, bookId: bId });
                                    if (bk && bk.ret === 0) summary.booksClaimed++;
                                } catch(e) {}
                            }

                            g.__vqRes = summary;
                        } catch(err) {
                            g.__vqErr = String(err);
                        }
                    })();

                    return 'STARTED';
                })();
}};
P.workers["tao_minh_tinh"]={definition:{"id": "tao_minh_tinh", "name": "Tạo minh tinh", "types": [1025], "action": "action_tao_minh_tinh", "var": "js_flow", "result": "__starExecRes", "error": "__starExecErr", "counters": ["movesDone", "gamesEnded"], "limit": 600},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (() => {
                    let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                    let req = g.__require || (typeof __require !== 'undefined' ? __require : null);
                    if (!req) return 'NO_REQUIRE';
                    let proto = req('Protocol');
                    if (proto && proto.Protocol) proto = proto.Protocol;
                    let gnu = req('GameNetUtil');
                    if (gnu && gnu.GameNetUtil) gnu = gnu.GameNetUtil;
                    if (gnu && gnu.getInstance) gnu = gnu.getInstance();
                    if (!gnu || !proto) return 'NO_GNU';

                    let actId = params.activityId;
                    let maxM = params.limit;
                    g.__starExecRes = null;
                    g.__starExecErr = null;

                    (async () => {
                        let summary = { movesDone: 0, gamesEnded: 0, endEnergy: 0, stopReason: '' };
                        try {
                            let info = await gnu.syncSeqSendMsg(proto.S_STAR_BUILD_INFO, { activityId: actId });
                            if (!info || (info.ret !== 0 && info.ret !== undefined)) {
                                summary.stopReason = 'info_fail';
                                g.__starExecRes = summary;
                                return;
                            }

                            let curEnergy = info.energy || 0;
                            let curBeauty = (info.gameData && info.gameData.beautyId) || 0;
                            if (!curBeauty) {
                                await gnu.syncSeqSendMsg(proto.S_STAR_BUILD_CHANGE_BEAUTY, { activityId: actId, newBeautyId: 103201 });
                            }

                            // 0: Lên, 1: Xuống, 2: Trái, 3: Phải
                            let dirs = [0, 1, 2, 3];
                            let dirIdx = 0;

                            while (curEnergy > 0 && summary.movesDone < maxM) {
                                let moved = false;
                                for (let attempt = 0; attempt < 4; attempt++) {
                                    let d = dirs[(dirIdx + attempt) % 4];
                                    let res = await gnu.syncSeqSendMsg(proto.S_STAR_BUILD_MOVE, { activityId: actId, move: d });
                                    if (res && (res.ret === 0 || res.ret === undefined)) {
                                        summary.movesDone++;
                                        curEnergy = (res.energy !== undefined) ? res.energy : (curEnergy - 1);
                                        dirIdx = (dirIdx + 1) % 4;
                                        moved = true;

                                        if (res.report && res.report.isDead) {
                                            let endRes = await gnu.syncSeqSendMsg(proto.S_STAR_BUILD_END_GAME, { activityId: actId });
                                            if (endRes && (endRes.ret === 0 || endRes.ret === undefined)) {
                                                summary.gamesEnded++;
                                            }
                                        }
                                        break;
                                    }
                                }

                                if (!moved) {
                                    let endRes = await gnu.syncSeqSendMsg(proto.S_STAR_BUILD_END_GAME, { activityId: actId });
                                    if (endRes && (endRes.ret === 0 || endRes.ret === undefined)) {
                                        summary.gamesEnded++;
                                    } else {
                                        summary.stopReason = 'board_stuck_end_fail';
                                        break;
                                    }
                                }
                            }

                            summary.endEnergy = curEnergy;
                            if (!summary.stopReason) summary.stopReason = (curEnergy <= 0) ? 'energy_depleted' : 'max_moves_reached';
                            g.__starExecRes = summary;
                        } catch(err) {
                            g.__starExecErr = String(err);
                        }
                    })();
                    return 'STARTED';
                })();
}};
P.workers["limited_quests"]={definition:{"id": "limited_quests", "name": "Nhiệm vụ hạn giờ", "types": [], "action": "action_limited_quests", "var": "js_code", "result": "__ltdClaimRes", "done": "done", "counters": ["count"]},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (() => {
                    let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                    g.__ltdClaimRes = { done: false, count: 0, claimable: [], claimed: [], error: null };
                    (async () => {
                        try {
                            let req = g.__require;
                            if (!req) {
                                g.__ltdClaimRes = { done: true, count: 0, error: 'no_require' };
                                return;
                            }
                            let am = req('ActivityMgr');
                            if (am && am.ActivityMgr) am = am.ActivityMgr;
                            let inst = am ? (am.inst || am.getInstance()) : null;
                            if (!inst) {
                                g.__ltdClaimRes = { done: true, count: 0, error: 'no_am' };
                                return;
                            }

                            let actDict = (inst.model && inst.model.activityDict) ? inst.model.activityDict : ((inst._model && inst._model.activityDict) ? inst._model.activityDict : {});
                            let ATU = null;
                            try { ATU = req('ActivityTaskUtil'); if (ATU && ATU.ActivityTaskUtil) ATU = ATU.ActivityTaskUtil; } catch(e) {}
                            let ANU = null;
                            try { ANU = req('ActivityNetUtil'); if (ANU && ANU.ActivityNetUtil) ANU = ANU.ActivityNetUtil; } catch(e) {}
                            let ActUtil = null;
                            try { ActUtil = req('ActivityUtil'); if (ActUtil && ActUtil.ActivityUtil) ActUtil = ActUtil.ActivityUtil; } catch(e) {}
                            let EventMgr = null;
                            try { EventMgr = req('EventMgr'); if (EventMgr && EventMgr.EventMgr) EventMgr = EventMgr.EventMgr.inst; } catch(e) {}
                            let ActConfig = null;
                            try { ActConfig = req('ActivityConfig'); if (ActConfig && ActConfig.ActivityConfig) ActConfig = ActConfig.ActivityConfig; } catch(e) {}

                            let candidateIds = [];
                            let targetActs = [];

                            // Quét tìm tất cả hoạt động thuộc dạng Nhiệm Vụ Hạn Giờ (Type 6 hoặc tên chứa Hạn Giờ nhưng không phải Nạp)
                            for (let k in actDict) {
                                let a = actDict[k];
                                if (!a) continue;
                                let info = a.info || {};
                                let cfg = a.config || {};
                                let aType = Number(a.activityType || info.activityType || cfg.activityType || 0);
                                let aName = String(a.title || info.activityName || cfg.activityName || a.name || "");
                                if (/nạp/i.test(aName)) continue;
                                if (aType === 6 || /hạn\s*giờ/i.test(aName) || /limited/i.test(aName)) {
                                    if (targetActs.indexOf(a) === -1) targetActs.push(a);
                                }
                            }

                            // Bổ sung hoạt động từ candidate IDs nếu chưa có
                            for (let cid of candidateIds) {
                                let a = actDict[String(cid)] || (actDict.get ? actDict.get(cid) : null);
                                if (a && targetActs.indexOf(a) === -1) {
                                    targetActs.push(a);
                                }
                            }

                            let totalFound = [];
                            let totalClaimed = [];

                            for (let a of targetActs) {
                                let aId = Number(a.activityId || a.id || 0);
                                if (!aId) continue;

                                // Đồng bộ dữ liệu mới nhất nếu có
                                if (typeof inst.requestActivityData === 'function') {
                                    try { await inst.requestActivityData(aId); } catch(e) {}
                                }

                                let ctemps = a.conditionTempDict || {};
                                let whichDay = 1;
                                try {
                                    if (ActUtil && typeof ActUtil.whichDay === 'function') {
                                        let bTime = a.info ? (a.info.beginTime || a.beginTime) : a.beginTime;
                                        whichDay = ActUtil.whichDay(bTime);
                                    }
                                } catch(e) {}

                                let toClaim = [];
                                for (let cid in ctemps) {
                                    let ct = ctemps[cid];
                                    if (!ct) continue;
                                    let cd = a.getConditionData ? a.getConditionData(ct.conditionId, true) : (a.conditionDataDict && a.conditionDataDict[cid]);
                                    let isClaimed = cd ? (cd.isGetReward === true || cd.isGetReward === 1 || cd.rewardStatus === 2) : false;
                                    if (isClaimed) continue;

                                    // Kiểm tra mốc ngày mở (paramList[2])
                                    let reqDay = (ct.paramList && ct.paramList[2] !== undefined) ? Number(ct.paramList[2]) : 0;
                                    if (reqDay > 0 && whichDay > 0 && whichDay < reqDay) continue;

                                    // Kiểm tra hoàn thành điều kiện
                                    let isDone = false;
                                    if (ATU && typeof ATU.buildTaskInfo === 'function') {
                                        let taskInfo = ATU.buildTaskInfo(a, ct, cd);
                                        if (taskInfo && (taskInfo.isComplete || (taskInfo.progressMax > 0 && taskInfo.progressValue >= taskInfo.progressMax))) {
                                            isDone = true;
                                        }
                                    }
                                    if (!isDone) {
                                        let curVal = cd ? Number(cd.value !== undefined ? cd.value : (cd.curVal || 0)) : 0;
                                        let needVal = (ct.paramList && ct.paramList[3] !== undefined) ? Number(ct.paramList[3]) : Number(ct.needVal || 0);
                                        if (needVal > 0 && curVal >= needVal) {
                                            isDone = true;
                                        }
                                    }

                                    if (isDone) {
                                        let condId = Number(ct.conditionId || cid);
                                        if (toClaim.indexOf(condId) === -1) {
                                            toClaim.push(condId);
                                        }
                                    }
                                }

                                if (toClaim.length > 0) {
                                    toClaim.forEach(id => { if (totalFound.indexOf(id) === -1) totalFound.push(id); });
                                    let claimedOk = false;

                                    // Phương án 1: Gọi getMultiReward qua ActivityNetUtil
                                    if (ANU && typeof ANU.getMultiReward === 'function') {
                                        try {
                                            let resMulti = await ANU.getMultiReward(aId, toClaim);
                                            if (resMulti && (resMulti.ret === 0 || resMulti.ret === undefined)) {
                                                claimedOk = true;
                                                let succ = resMulti.successConditionId || toClaim;
                                                succ.forEach(function(scid) {
                                                    if (typeof a.setConditionRewardReceived === 'function') {
                                                        a.setConditionRewardReceived(scid);
                                                    } else if (a.conditionDataDict && a.conditionDataDict[scid]) {
                                                        a.conditionDataDict[scid].isGetReward = true;
                                                    }
                                                    if (totalClaimed.indexOf(scid) === -1) totalClaimed.push(scid);
                                                });
                                            }
                                        } catch(e) {}
                                    }

                                    // Phương án 2: Gọi requestGetReward qua ActivityMgr
                                    if (!claimedOk && typeof inst.requestGetReward === 'function') {
                                        try {
                                            await inst.requestGetReward(a, toClaim);
                                            claimedOk = true;
                                            toClaim.forEach(function(scid) {
                                                if (typeof a.setConditionRewardReceived === 'function') {
                                                    a.setConditionRewardReceived(scid);
                                                }
                                                if (totalClaimed.indexOf(scid) === -1) totalClaimed.push(scid);
                                            });
                                        } catch(e) {}
                                    }

                                    // Phương án 3: Gọi nhận lẻ từng mốc qua ActivityNetUtil.getReward
                                    if (!claimedOk && ANU && typeof ANU.getReward === 'function') {
                                        for (let singleId of toClaim) {
                                            try {
                                                let rSingle = await ANU.getReward(aId, singleId);
                                                if (rSingle && (rSingle.ret === 0 || rSingle.ret === undefined)) {
                                                    if (typeof a.setConditionRewardReceived === 'function') {
                                                        a.setConditionRewardReceived(singleId);
                                                    }
                                                    if (totalClaimed.indexOf(singleId) === -1) totalClaimed.push(singleId);
                                                }
                                            } catch(e) {}
                                        }
                                    }

                                    // Cập nhật giao diện & xóa dấu đỏ
                                    try {
                                        if (EventMgr) {
                                            if (ActConfig && ActConfig.EVENT_ACTIVITY_TREE_REDPOINT) {
                                                EventMgr.emit(ActConfig.EVENT_ACTIVITY_TREE_REDPOINT, aId);
                                            }
                                            if (ActConfig && ActConfig.EVENT_ACTIVITY_UPDATE) {
                                                EventMgr.emit(ActConfig.EVENT_ACTIVITY_UPDATE, [aId]);
                                            }
                                        }
                                    } catch(e) {}
                                }
                            }

                            g.__ltdClaimRes = {
                                done: true,
                                count: totalClaimed.length,
                                claimable: totalFound,
                                claimed: totalClaimed,
                                error: null
                            };
                        } catch(err) {
                            g.__ltdClaimRes = { done: true, count: 0, error: String(err) };
                        }
                    })();
                    return 'started';
                })();
}};
P.workers["guild_exp_boxes"]={definition:{"id": "guild_exp_boxes", "name": "EXP công hội: mua mảnh búa", "types": [], "action": "action_exp_cong_hoi_mua_manh_bua", "var": "js_code", "result": "__buyExpRes", "done": "done", "counters": ["newBuys"]},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (() => {
                let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                let req = g.__require;
                if (!req) {
                    return JSON.stringify({ done: true, isEventOpen: false, noReq: true });
                }

                let AM = null;
                try { AM = req('ActivityMgr'); } catch(e) {}
                let amInst = AM && (AM.inst || (AM.ActivityMgr && AM.ActivityMgr.inst));
                let aDict = (amInst && amInst.model && amInst.model.activityDict) || {};

                let DBU = null;
                try { DBU = req('DBUtil'); } catch(e) {}
                let dbu = DBU && (DBU.DBUtil || DBU);

                let mallId = 2001101801;
                let cfg = dbu && dbu.getShop ? dbu.getShop(mallId) : null;

                // 1. Kiểm tra sự kiện liên kết trực tiếp hoặc trong activityDict
                let isEventOpen = false;
                let eventName = "";

                if (cfg && cfg.activityId) {
                    let act = aDict[cfg.activityId];
                    let isOpen = amInst ? (amInst.isActivityOpen ? amInst.isActivityOpen(cfg.activityId) : Boolean(act)) : false;
                    if (isOpen && act) {
                        isEventOpen = true;
                        eventName = act.title || (act.info && act.info.activityName) || "";
                    }
                }

                if (!isEventOpen) {
                    for (let aid in aDict) {
                        let act = aDict[aid];
                        if (!act) continue;
                        let mall = act.mallDict || (act.configDict && act.configDict.mall) || (act.config && act.config.mall) || {};
                        if (mall && (mall[mallId] || mall[String(mallId)])) {
                            isEventOpen = true;
                            eventName = act.title || (act.info && act.info.activityName) || "";
                            break;
                        }
                    }
                }

                if (!isEventOpen) {
                    for (let aid in aDict) {
                        let act = aDict[aid];
                        if (!act) continue;
                        let aName = (act.title || (act.info && act.info.activityName) || (act.config && act.config.activityName) || "").toLowerCase();
                        if ((aName.includes('công hội') && (aName.includes('búa') || aName.includes('exp'))) || aName.includes('mảnh búa') || aName.includes('đua exp')) {
                            isEventOpen = true;
                            eventName = act.title || (act.info && act.info.activityName) || "";
                            break;
                        }
                    }
                }

                // NẾU SỰ KIỆN CHƯA MỞ HÔM NAY: TUYỆT ĐỐI KHÔNG GỬI REQUEST MUA, DỪNG NGAY!
                if (!isEventOpen) {
                    g.__buyExpRes = { done: true, isEventOpen: false, eventName: "", boughtCount: 0, limit: 2, diamonds: 0, newBuys: 0, error: null };
                    return JSON.stringify(g.__buyExpRes);
                }

                let SM = null;
                try { SM = req('ShopMgr'); } catch(e) {}
                let smInst = SM && (SM.inst || (SM.ShopMgr && SM.ShopMgr.inst));
                let BM = null;
                try { BM = req('BagMgr'); } catch(e) {}
                let bmInst = BM && (BM.inst || (BM.BagMgr && BM.BagMgr.inst));
                let SNU = null;
                try { SNU = req('ShopNetUtil'); } catch(e) {}
                let net = SNU && (SNU.ShopNetUtil || SNU);

                let bought = smInst ? smInst.getShopBuyGoodsCount(mallId) : 0;
                let diamonds = bmInst ? Number(bmInst.getOwnCount(101001) || 0) : 0;
                let limit = cfg ? (cfg.buyLimit || 2) : 2;

                g.__buyExpRes = { done: false, isEventOpen: true, eventName: eventName, boughtCount: bought, limit: limit, diamonds: diamonds, newBuys: 0, error: null };

                if (bought >= limit) {
                    g.__buyExpRes.done = true;
                    return JSON.stringify(g.__buyExpRes);
                }

                (async () => {
                    try {
                        let toBuy = limit - bought;
                        let successBuys = 0;
                        for (let i = 0; i < toBuy; i++) {
                            if (diamonds < 388) {
                                break;
                            }
                            let res = null;
                            if (smInst && smInst.requestBuy) {
                                res = await new Promise((resolve) => {
                                    smInst.requestBuy({
                                        shopId: mallId,
                                        buyCount: 1,
                                        showReward: false,
                                        onSuccess: (r) => resolve(r),
                                        onFail: (e) => resolve({ ret: -1, err: e })
                                    });
                                });
                            } else if (net && net.buyGoods) {
                                res = await net.buyGoods(mallId, 1);
                            }
                            if (res && res.ret === 0) {
                                successBuys++;
                                diamonds -= 388;
                            } else {
                                break;
                            }
                        }
                        g.__buyExpRes.done = true;
                        g.__buyExpRes.newBuys = successBuys;
                    } catch(e) {
                        g.__buyExpRes.done = true;
                        g.__buyExpRes.error = String(e);
                    }
                })();
                return JSON.stringify(g.__buyExpRes);
            })();
}};
P.workers["gieng_co_phat_sang"]={definition:{"id": "gieng_co_phat_sang", "name": "Giếng cổ phát sáng", "types": [1018], "action": "action_gieng_co_phat_sang", "var": "js_code", "result": "__digSmartRes", "done": "done", "counters": ["dug"]},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (() => {
                        let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                        let req = g.__require;
                        let gnu = req('GameNetUtil');
                        if (gnu && gnu.GameNetUtil) gnu = gnu.GameNetUtil;
                        let proto = req('Protocol');
                        if (proto && proto.Protocol) proto = proto.Protocol;
                        let BM = req('BagMgr');
                        let bInst = BM && (BM.inst || (BM.BagMgr && BM.BagMgr.inst));
                        
                        g.__digSmartRes = { done: false, dug: 0, error: null };
                        (async () => {
                            try {
                                let actId = params.activityId;
                                let toolIds = [121035, 121036, 121037];
                                
                                let info = await gnu.syncSeqSendMsg(proto.S_DIGGOLD_INFO, { activityId: actId });
                                if (!info || info.ret !== 0) {
                                    g.__digSmartRes = { done: true, dug: 0, error: 'no_info' };
                                    return;
                                }
                                let blocks = info.boardBlock || [];
                                let dug = 0;
                                
                                for (let step = 0; step < 60; step++) {
                                    let shovelCount = bInst ? Number(bInst.getOwnCount(121035) || 0) : 0;
                                    let bombCount = bInst ? Number(bInst.getOwnCount(121037) || 0) : 0;
                                    if (shovelCount <= 0 && bombCount <= 0) break;
                                    
                                    let available = blocks.filter(b => b.connect && b.blockType > 0);
                                    if (available.length === 0) break;
                                    
                                    let target = null;
                                    // 1. Ô liền kề có chứa công cụ (xẻng, bom, khoan)
                                    for (let b of available) {
                                        if (toolIds.includes(b.rewardId)) { target = b; break; }
                                    }
                                    // 2. Ô liền kề có chứa cổ vật/kho báu
                                    if (!target) {
                                        for (let b of available) {
                                            if (b.rewardId > 0 || b.rewardType > 0) { target = b; break; }
                                        }
                                    }
                                    // 3. Định tuyến ngắn nhất tới ô công cụ chưa mở
                                    if (!target) {
                                        let unreachedTools = blocks.filter(b => !b.connect && b.blockType > 0 && toolIds.includes(b.rewardId));
                                        if (unreachedTools.length > 0) {
                                            let bestDist = 9999;
                                            for (let cand of available) {
                                                let cr = Math.floor(cand.blockIndex / 6), cc = cand.blockIndex % 6;
                                                for (let t of unreachedTools) {
                                                    let tr = Math.floor(t.blockIndex / 6), tc = t.blockIndex % 6;
                                                    let dist = Math.abs(cr - tr) + Math.abs(cc - tc);
                                                    if (dist < bestDist) { bestDist = dist; target = cand; }
                                                }
                                            }
                                        }
                                    }
                                    // 4. Định tuyến ngắn nhất tới ô cổ vật chưa mở
                                    if (!target) {
                                        let unreachedRewards = blocks.filter(b => !b.connect && b.blockType > 0 && (b.rewardId > 0 || b.rewardType > 0));
                                        if (unreachedRewards.length > 0) {
                                            let bestDist = 9999;
                                            for (let cand of available) {
                                                let cr = Math.floor(cand.blockIndex / 6), cc = cand.blockIndex % 6;
                                                for (let t of unreachedRewards) {
                                                    let tr = Math.floor(t.blockIndex / 6), tc = t.blockIndex % 6;
                                                    let dist = Math.abs(cr - tr) + Math.abs(cc - tc);
                                                    if (dist < bestDist) { bestDist = dist; target = cand; }
                                                }
                                            }
                                        }
                                    }
                                    // 5. Mặc định đào ô gần đáy nhất
                                    if (!target) {
                                        target = available[available.length - 1];
                                    }
                                    
                                    let useItemId = (shovelCount > 0) ? 121035 : 121037;
                                    let res = await gnu.syncSeqSendMsg(proto.S_DIGGOLD_USE, { activityId: actId, itemId: useItemId, blockIndex: target.blockIndex });
                                    if (res && res.ret === 0) {
                                        dug++;
                                        blocks = res.boardBlock || blocks;
                                    } else {
                                        break;
                                    }
                                }
                                g.__digSmartRes = { done: true, dug: dug, error: null };
                            } catch(e) {
                                g.__digSmartRes = { done: true, dug: 0, error: String(e) };
                            }
                        })();
                        return 'started';
                    })();
}};
P.workers["tranh_ba_hai_vuc"]={definition:{"id": "tranh_ba_hai_vuc", "name": "Tranh bá hải vực", "types": [1093], "action": "action_tranh_ba_hai_vuc", "var": "js_code", "result": "__fishSmartRes", "done": "done", "counters": ["actions", "killed"]},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (() => {
                        let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                        let req = g.__require;
                        let gnu = req('GameNetUtil');
                        if (gnu && gnu.GameNetUtil) gnu = gnu.GameNetUtil;
                        let proto = req('Protocol');
                        if (proto && proto.Protocol) proto = proto.Protocol;
                        let BM = req('BagMgr');
                        let bInst = BM && (BM.inst || (BM.BagMgr && BM.BagMgr.inst));
                        
                        g.__fishSmartRes = { done: false, actions: 0, killed: 0, advancedRegions: [], endRegion: 101, error: null };
                        (async () => {
                            try {
                                let actId = params.activityId;
                                let d = await gnu.syncSeqSendMsg(proto.S_FISH_KING_DATA, { activityId: actId });
                                if (!d || d.ret !== 0) {
                                    g.__fishSmartRes.done = true;
                                    return;
                                }
                                let curRegion = d.myRegion || 101;
                                let curPower = (d.power !== undefined) ? d.power : 0;
                                
                                async function tryAdvanceRegion() {
                                    let ecRes = await gnu.syncSeqSendMsg(proto.S_FISH_KING_EVENT_COUNT, { activityId: actId });
                                    let ecMap = {};
                                    for (let item of (ecRes && ecRes.eventCount || [])) {
                                        ecMap[item.eventId] = item.count;
                                    }
                                    let propCount = bInst ? Number(bInst.getOwnCount(121202) || 0) : 0;
                                    
                                    let targetRegion = 0;
                                    if (curRegion === 101) {
                                        if ((ecMap[20113] || 0) >= 2 || propCount >= 2) targetRegion = 102;
                                    } else if (curRegion === 102) {
                                        if ((ecMap[20123] || 0) >= 2 || propCount >= 2) targetRegion = 103;
                                    } else if (curRegion === 201) {
                                        if ((ecMap[20213] || 0) >= 2 || propCount >= 2) targetRegion = 202;
                                    }
                                    
                                    if (targetRegion > 0) {
                                        let enterRes = await gnu.syncSeqSendMsg(proto.S_FISH_KING_ENTER_REGION, { activityId: actId, regionId: targetRegion, userProp: false });
                                        if (!enterRes || enterRes.ret !== 0) {
                                            if (propCount >= 2) {
                                                enterRes = await gnu.syncSeqSendMsg(proto.S_FISH_KING_ENTER_REGION, { activityId: actId, regionId: targetRegion, userProp: true });
                                            }
                                        }
                                        if (enterRes && enterRes.ret === 0) {
                                            curRegion = targetRegion;
                                            g.__fishSmartRes.advancedRegions.push(targetRegion);
                                            return true;
                                        }
                                    }
                                    return false;
                                }
                                
                                await tryAdvanceRegion();
                                
                                for (let step = 0; step < 50 && curPower > 0; step++) {
                                    // 1. Tấn công quái của đồng đội nếu có
                                    let latestData = await gnu.syncSeqSendMsg(proto.S_FISH_KING_DATA, { activityId: actId });
                                    if (latestData && latestData.monsterList) {
                                        for (let m of latestData.monsterList) {
                                            if (m && m.id && m.monster && m.monster.blood > 0) {
                                                try {
                                                    let attRes = await gnu.syncSeqSendMsg(proto.S_FISH_KING_ATTACK, { activityId: actId, monsterId: m.id });
                                                    if (attRes && attRes.ret === 0 && attRes.kill) {
                                                        g.__fishSmartRes.killed++;
                                                    }
                                                } catch(e) {}
                                            }
                                            if (m && m.id && m.monster && m.monster.blood <= 0 && !m.getReward) {
                                                try {
                                                    await gnu.syncSeqSendMsg(proto.S_FISH_KING_MARKED_MONSTER_REWARD, { activityId: actId, monsterId: m.id });
                                                } catch(e) {}
                                            }
                                        }
                                    }
                                    
                                    // 2. Thám hiểm biển tiêu thụ thể lực
                                    let actRes = await gnu.syncSeqSendMsg(proto.S_FISH_KING_ACTION, { activityId: actId });
                                    if (actRes && actRes.ret === 0) {
                                        g.__fishSmartRes.actions++;
                                        curPower = (actRes.power !== undefined) ? actRes.power : (curPower - 1);
                                        
                                        if (actRes.event) {
                                            if (actRes.event.monster) {
                                                try {
                                                    let att = await gnu.syncSeqSendMsg(proto.S_FISH_KING_ATTACK, { activityId: actId, monsterId: 0 });
                                                    if (att && att.ret === 0) {
                                                        if (att.kill) {
                                                            g.__fishSmartRes.killed++;
                                                        } else {
                                                            await gnu.syncSeqSendMsg(proto.S_FISH_KING_MONSTER_MARK, { activityId: actId });
                                                        }
                                                    } else {
                                                        await gnu.syncSeqSendMsg(proto.S_FISH_KING_MONSTER_MARK, { activityId: actId });
                                                    }
                                                } catch(e) {}
                                            }
                                            
                                            try {
                                                let checkD = await gnu.syncSeqSendMsg(proto.S_FISH_KING_DATA, { activityId: actId });
                                                if (checkD && checkD.waitHandleEvent) {
                                                    let cRes = await gnu.syncSeqSendMsg(proto.S_FISH_KING_CATCH, { activityId: actId });
                                                    if (!cRes || cRes.ret !== 0) {
                                                        await gnu.syncSeqSendMsg(proto.S_FISH_KING_ESCAPE, { activityId: actId });
                                                    }
                                                }
                                            } catch(e) {}
                                        }
                                        
                                        await tryAdvanceRegion();
                                    } else if (actRes && actRes.ret === 11491) {
                                        try {
                                            let att = await gnu.syncSeqSendMsg(proto.S_FISH_KING_ATTACK, { activityId: actId, monsterId: 0 });
                                            if (!att || !att.kill) {
                                                let mRes = await gnu.syncSeqSendMsg(proto.S_FISH_KING_MONSTER_MARK, { activityId: actId });
                                                if (!mRes || mRes.ret !== 0) {
                                                    await gnu.syncSeqSendMsg(proto.S_FISH_KING_ESCAPE, { activityId: actId });
                                                }
                                            }
                                        } catch(e) {
                                            try { await gnu.syncSeqSendMsg(proto.S_FISH_KING_ESCAPE, { activityId: actId }); } catch(ex) {}
                                        }
                                    } else {
                                        break;
                                    }
                                }
                                
                                await tryAdvanceRegion();
                                g.__fishSmartRes.endRegion = curRegion;
                                g.__fishSmartRes.done = true;
                            } catch(e) {
                                g.__fishSmartRes.done = true;
                                g.__fishSmartRes.error = String(e);
                            }
                        })();
                        return 'started';
                    })();
}};
P.workers["den_hoa_cau_nguyen"]={definition:{"id": "den_hoa_cau_nguyen", "name": "Đèn hoa cầu nguyện", "types": [1068], "action": "action_den_hoa_cau_nguyen", "var": "js_unified", "result": "_lotus_unified_res", "doneGlobal": "_lotus_unified_done", "counters": ["claimedTasksCount", "drawCount", "claimedMilestones"]},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (function() {
                    try {
                        window._lotus_unified_done = false;
                        window._lotus_unified_res = null;

                        var req = window.__require;
                        if (!req) {
                            window._lotus_unified_res = JSON.stringify({ error: "No __require" });
                            window._lotus_unified_done = true;
                            return "NO_REQ";
                        }

                        var actId = params.activityId;
                        var ActMgr = req('ActivityMgr').ActivityMgr.inst;
                        var actDict = ActMgr._model.activityDict;
                        var targetAct = null;
                        for (var k in actDict) {
                            var a = actDict[k];
                            if (a && (a.id == actId || a.activityId == actId || a.type == 1068)) { targetAct = a; break; }
                        }
                        if (!targetAct && actDict.get) {
                            targetAct = actDict.get(actId) || actDict.get(actId.toString());
                        }

                        var LM = req('ActivityWishingLanternMgr').ActivityWishingLanternMgr.inst;
                        var NetUtil = req('ActivityWishingLanternNetUtil').ActivityWishingLanternNetUtil;
                        var ActNetUtil = req('ActivityNetUtil') ? (req('ActivityNetUtil').ActivityNetUtil || req('ActivityNetUtil').default) : null;
                        var WishUtil = req('ActivityWishingLanternUtil').ActivityWishingLanternUtil;
                        var TaskUtil = req('ActivityTaskUtil') ? (req('ActivityTaskUtil').ActivityTaskUtil || req('ActivityTaskUtil').default) : null;
                        var BagMgr = req('BagMgr').BagMgr.inst;

                        (async function() {
                            var logs = [];
                            try {
                                // Bước 4.1: Nhận toàn bộ quà nhiệm vụ đã hoàn thành
                                var claimedTasksCount = 0;
                                if (targetAct && ActNetUtil && WishUtil && TaskUtil) {
                                    var condType = WishUtil.getTaskDataType(targetAct);
                                    var r = targetAct.getConditionTempListByDataType(condType) || [];
                                    var eligibleIds = [];
                                    for (var l = 0; l < r.length; l++) {
                                        var c = r[l];
                                        var u = targetAct.getConditionData(c.conditionId, true);
                                        var v = TaskUtil.buildTaskInfo(targetAct, c, u);
                                        if (v && v.isComplete && (!u || !u.isGetReward)) {
                                            eligibleIds.push(c.conditionId);
                                        }
                                    }
                                    if (eligibleIds.length > 0) {
                                        var resMulti = await ActNetUtil.getMultiReward(actId, eligibleIds);
                                        if (resMulti && resMulti.ret === 0) {
                                            claimedTasksCount = eligibleIds.length;
                                            if (resMulti.successConditionId) {
                                                resMulti.successConditionId.forEach(function(cid) {
                                                    targetAct.setConditionRewardReceived(cid);
                                                });
                                            }
                                        }
                                    }
                                }

                                // Bước 4.2: Đồng bộ dữ liệu sự kiện Đèn Hoa Cầu Nguyện
                                var wishingData = LM.model.getWishingData(actId);
                                if (!wishingData || !wishingData.hasSyncConfig) {
                                    await NetUtil.getConfig(actId);
                                }
                                if (!wishingData || !wishingData.hasSyncData) {
                                    await NetUtil.getData(actId);
                                }
                                wishingData = LM.model.getWishingData(actId);
                                if (!wishingData) {
                                    window._lotus_unified_res = JSON.stringify({
                                        claimedTasksCount: claimedTasksCount,
                                        drawCount: 0,
                                        error: "No wishingData"
                                    });
                                    window._lotus_unified_done = true;
                                    return;
                                }

                                // Bước 4.3: Vòng lặp Mở hoa sen (Cầu nguyện) bằng toàn bộ nến có trong túi
                                var drawCount = 0;
                                var loopLimit = 100;

                                while (loopLimit-- > 0) {
                                    var candles = parseInt(BagMgr.getOwnCount(120321) || 0);
                                    var drawInfo = wishingData.drawInfo;
                                    if (!drawInfo) break;

                                    // Nếu sang vòng mới mà chưa chọn quà ước nguyện (big == 0)
                                    if (!drawInfo.big || drawInfo.big === 0) {
                                        var bigRes = await NetUtil.getBig(actId, 1);
                                        if (bigRes && bigRes.ret === 0 && bigRes.drawInfo) {
                                            wishingData.syncDrawInfo(bigRes.drawInfo);
                                            drawInfo = wishingData.drawInfo;
                                        } else {
                                            break;
                                        }
                                    }

                                    // Chi phí nến mỗi lần mở
                                    var consume = 1;
                                    var mapInfo = wishingData.currrentMapInfo;
                                    if (mapInfo && mapInfo.config && mapInfo.config.consume) {
                                        consume = mapInfo.config.consume;
                                    }

                                    if (candles < consume) break;

                                    // Tìm ô sen chưa mở (lid == 0)
                                    var targetLamp = null;
                                    if (drawInfo.roundInfo && drawInfo.roundInfo.lampList) {
                                        for (var i = 0; i < drawInfo.roundInfo.lampList.length; i++) {
                                            var lamp = drawInfo.roundInfo.lampList[i];
                                            if (lamp && lamp.lid === 0) {
                                                targetLamp = lamp;
                                                break;
                                            }
                                        }
                                    }

                                    if (!targetLamp) break;

                                    // Gửi lệnh mở ô sen
                                    var drawRes = await NetUtil.getDraw(actId, targetLamp.x, targetLamp.y);
                                    if (drawRes && drawRes.ret === 0) {
                                        drawCount++;
                                        if (drawRes.times !== undefined) wishingData.syncTimes(drawRes.times);
                                        if (drawRes.drawInfo) wishingData.syncDrawInfo(drawRes.drawInfo);
                                        if (drawRes.pickMap) wishingData.syncPickMap(drawRes.pickMap);
                                    } else {
                                        break;
                                    }
                                }

                                // Bước 4.4: Nhận thưởng các mốc Lượt Cầu Nguyện
                                var claimedMilestones = 0;
                                var configs = wishingData.progressConfigs || [];
                                var takeList = wishingData.takeList || [];
                                for (var m = 0; m < configs.length; m++) {
                                    var cfg = configs[m];
                                    if (cfg && wishingData.times >= cfg.progress && takeList.indexOf(cfg.id) === -1) {
                                        var tRes = await NetUtil.getTask(actId, cfg.id);
                                        if (tRes && tRes.ret === 0) {
                                            claimedMilestones++;
                                            takeList.push(cfg.id);
                                        }
                                    }
                                }

                                // Bước 4.5: Đóng sạch sẽ toàn bộ các View / popup liên quan
                                var UIMgr = req("UIMgr").UIMgr.inst;
                                var ViewClsList = [
                                    req("ActivityTaskView1"),
                                    req("ActivityWishingLanternMainView"),
                                    req("ActivityWishingLanternGameView"),
                                    req("ActivityWishingLanternRewardView"),
                                    req("ActivityWishingLanternSelectRewardView")
                                ];
                                for (var v = 0; v < ViewClsList.length; v++) {
                                    var mod = ViewClsList[v];
                                    if (mod) {
                                        var cls = mod.ActivityTaskView1 || mod.ActivityWishingLanternMainView || mod.ActivityWishingLanternGameView || mod.ActivityWishingLanternRewardView || mod.ActivityWishingLanternSelectRewardView || mod.default;
                                        if (cls) try { UIMgr.close(cls); } catch(e) {}
                                    }
                                }

                                var fg = fgui;
                                if (fg && fg.GRoot && fg.GRoot.inst) {
                                    var entry = fg.GRoot.inst.getChild('Entry');
                                    if (entry && entry.getChild('content')) {
                                        var lw = entry.getChild('content').getChild('layWindow');
                                        if (lw) {
                                            ['ActivityTaskView1', 'ActivityWishingLanternMainView', 'ActivityWishingLanternGameView', 'ActivityWishingLanternRewardView', 'ActivityWishingLanternSelectRewardView'].forEach(function(nm) {
                                                var w = lw.getChild(nm);
                                                if (w) { w.removeFromParent(); try { w.dispose(); } catch(e) {} }
                                            });
                                        }
                                    }
                                }

                                var remCandles = parseInt(BagMgr.getOwnCount(120321) || 0);
                                window._lotus_unified_res = JSON.stringify({
                                    success: true,
                                    claimedTasksCount: claimedTasksCount,
                                    drawCount: drawCount,
                                    claimedMilestones: claimedMilestones,
                                    remainingCandles: remCandles,
                                    times: wishingData.times
                                });
                                window._lotus_unified_done = true;

                            } catch(err) {
                                window._lotus_unified_res = JSON.stringify({ error: err.toString() });
                                window._lotus_unified_done = true;
                            }
                        })();

                        return "LAUNCHED";
                    } catch(e) {
                        return "ERR: " + e.toString();
                    }
                })();
}};
P.workers["vo_lam_forge"]={definition:{"id": "vo_lam_forge", "name": "Võ lâm: rèn và trang bị", "types": [1086], "action": "action_vo_lam_truyen_ky", "var": "js_forge_full", "result": "__volam_unified_res", "doneGlobal": "__volam_unified_done", "counters": ["forgedCount", "replacedCount", "levelUps", "claimedTrialCount"]},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (function() {
                    try {
                        window.__volam_unified_done = false;
                        window.__volam_unified_res = null;

                        var req = window.__require;
                        if (!req) {
                            window.__volam_unified_res = JSON.stringify({ error: "No __require" });
                            window.__volam_unified_done = true;
                            return "NO_REQ";
                        }

                        var actId = params.activityId;
                        var actMgr = req('ActivityMgr').ActivityMgr.inst;
                        var act = actMgr.getActivity(actId);
                        if (!act) {
                            window.__volam_unified_res = JSON.stringify({ error: "No act" });
                            window.__volam_unified_done = true;
                            return "NO_ACT";
                        }

                        var mgr = req('ActivityFengyunCopyMgr').ActivityFengyunCopyMgr.inst;
                        var util = req('ActivityFengyunCopyUtil').ActivityFengyunCopyUtil;
                        var ActNetUtil = req('ActivityNetUtil') ? (req('ActivityNetUtil').ActivityNetUtil || req('ActivityNetUtil').default) : null;
                        var TaskUtil = req('ActivityTaskUtil') ? (req('ActivityTaskUtil').ActivityTaskUtil || req('ActivityTaskUtil').default) : null;

                        function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

                        (async function() {
                            try {
                                // 4.0 Đồng bộ thông tin Lò Rèn từ Server trước khi rèn
                                await mgr.reqWindForgeInfo(act);
                                await sleep(300);

                                // Thử nâng bậc thợ rèn khởi đầu nếu đã đủ điểm kinh nghiệm
                                await mgr.reqWindForgeLevelUp(act);
                                await sleep(250);

                                var forgedCount = 0;
                                var replacedCount = 0;
                                var batch = 0;
                                var levelUps = 0;
                                var fd = mgr.model.getForgeData(actId);
                                var curLev = fd ? (fd.forgeLev || fd._forgeLev || 1) : 1;

                                // 4.1 Giải phóng các món kẹt trong wait nếu có
                                if (fd && fd.wait && fd.wait.length > 0) {
                                    for (var w = 0; w < fd.wait.length; w++) {
                                        var wItem = fd.wait[w];
                                        var curScoreW = util.getTotalAttrScore(act, null);
                                        var newScoreW = util.getTotalAttrScore(act, wItem);
                                        var equipListW = (fd && fd.equip) ? fd.equip : [];
                                        var oldItemW = null;
                                        for (var ew = 0; ew < equipListW.length; ew++) {
                                            if (equipListW[ew].slot === wItem.slot) {
                                                oldItemW = equipListW[ew];
                                                break;
                                            }
                                        }

                                        var handleTypeW = 2; // mặc định tách
                                        if (!oldItemW) {
                                            handleTypeW = 1;
                                            replacedCount++;
                                        } else if (newScoreW > curScoreW && wItem.quality >= oldItemW.quality) {
                                            handleTypeW = 1;
                                            replacedCount++;
                                        }
                                        await mgr.reqWindForgeHandle(act, handleTypeW, [wItem.uniqueId]);
                                        await sleep(250);
                                    }
                                }

                                // 4.2 Vòng lặp rèn: Rèn 5 cái kiểm tra nâng cấp thợ rèn 1 lần
                                var maxForges = 300;
                                while (maxForges-- > 0) {
                                    var fRes = await mgr.reqWindForge(act);
                                    await sleep(250);

                                    // Nếu kẹt code 10421 -> đồng bộ lại thông tin lò rèn và dọn món kẹt
                                    if (fRes && fRes.msg && fRes.msg.ret === 10421) {
                                        await mgr.reqWindForgeInfo(act);
                                        await sleep(250);
                                        var fdW = mgr.model.getForgeData(actId);
                                        if (fdW && fdW.wait && fdW.wait.length > 0) {
                                            await mgr.reqWindForgeHandle(act, 2, [fdW.wait[0].uniqueId]);
                                            await sleep(250);
                                            continue;
                                        }
                                    }

                                    // Hết đá rèn hoặc lỗi -> dừng rèn
                                    if (!fRes || !fRes.isOk) {
                                        break;
                                    }

                                    forgedCount++;
                                    batch++;

                                    // Xử lý trang bị vừa rèn: So sánh với món đang mặc
                                    var waitList = (fRes.msg && fRes.msg.wait) ? fRes.msg.wait : [];
                                    if (waitList.length > 0) {
                                        var newItem = waitList[0];
                                        fd = mgr.model.getForgeData(actId);
                                        var equipList = (fd && fd.equip) ? fd.equip : [];
                                        var oldItem = null;
                                        for (var eIdx = 0; eIdx < equipList.length; eIdx++) {
                                            if (equipList[eIdx].slot === newItem.slot) {
                                                oldItem = equipList[eIdx];
                                                break;
                                            }
                                        }

                                        var curScore = util.getTotalAttrScore(act, null);
                                        var newScore = util.getTotalAttrScore(act, newItem);

                                        var handleType = 2; // mặc định 2: tách/bán món mới
                                        if (!oldItem) {
                                            handleType = 1; // chưa có món nào ở ô này -> mặc vào
                                            replacedCount++;
                                        } else if (newScore > curScore && newItem.quality >= oldItem.quality) {
                                            // CHỈ THAY THẾ KHI: Lực chiến tăng VÀ phẩm chất không thấp hơn đồ cũ
                                            handleType = 1;
                                            replacedCount++;
                                        }

                                        await mgr.reqWindForgeHandle(act, handleType, [newItem.uniqueId]);
                                        await sleep(250);
                                    }

                                    // ĐÃ RÈN ĐỦ 5 CÁI: KIỂM TRA NÂNG CẤP THỢ RÈN 1 LẦN!
                                    if (batch >= 5) {
                                        batch = 0;
                                        var upRes = await mgr.reqWindForgeLevelUp(act);
                                        await sleep(250);
                                        if (upRes && upRes.isOk) {
                                            levelUps++;
                                            fd = mgr.model.getForgeData(actId);
                                            if (fd) curLev = (fd.forgeLev || fd._forgeLev || curLev);
                                        }
                                    }
                                }

                                // 4.3 Kiểm tra nâng thợ rèn lần cuối khi hết lượt rèn
                                var finalUp = await mgr.reqWindForgeLevelUp(act);
                                await sleep(250);
                                if (finalUp && finalUp.isOk) {
                                    levelUps++;
                                    fd = mgr.model.getForgeData(actId);
                                    if (fd) curLev = (fd.forgeLev || fd._forgeLev || curLev);
                                }

                                // 4.4 Nhận thưởng Con Đường Thử Thách ở CẢ 2 MỤC (Thực Lực & Cảnh Giới)
                                var claimedTrialCount = 0;
                                if (ActNetUtil && TaskUtil && util) {
                                    var dtScore = util.getScoreAchieveDataType(act);
                                    var dtLevel = util.getLevelAchieveDataType(act);

                                    var rScore = act.getConditionTempListByDataType(dtScore) || [];
                                    var rLevel = act.getConditionTempListByDataType(dtLevel) || [];

                                    var eligibleTrailIds = [];
                                    var allConds = rScore.concat(rLevel);
                                    for (var cIdx = 0; cIdx < allConds.length; cIdx++) {
                                        var cItem = allConds[cIdx];
                                        var uData = act.getConditionData(cItem.conditionId, true);
                                        var vInfo = TaskUtil.buildTaskInfo(act, cItem, uData);
                                        if (vInfo && vInfo.isComplete && (!uData || !uData.isGetReward)) {
                                            if (eligibleTrailIds.indexOf(cItem.conditionId) === -1) {
                                                eligibleTrailIds.push(cItem.conditionId);
                                            }
                                        }
                                    }

                                    if (eligibleTrailIds.length > 0) {
                                        var tRes = await ActNetUtil.getMultiReward(actId, eligibleTrailIds);
                                        if (tRes && tRes.ret === 0) {
                                            claimedTrialCount = eligibleTrailIds.length;
                                            if (tRes.successConditionId) {
                                                tRes.successConditionId.forEach(function(cid) {
                                                    act.setConditionRewardReceived(cid);
                                                });
                                            }
                                        }
                                    }
                                }

                                // Kiểm tra nâng bậc thợ rèn thêm lần nữa nếu vừa nhận thêm búa từ Con Đường Thử Thách
                                var postTrialUp = await mgr.reqWindForgeLevelUp(act);
                                await sleep(250);
                                if (postTrialUp && postTrialUp.isOk) {
                                    levelUps++;
                                    fd = mgr.model.getForgeData(actId);
                                    if (fd) curLev = (fd.forgeLev || fd._forgeLev || curLev);
                                }

                                // 4.5 Đóng sạch sẽ các popup liên quan an toàn qua UIMgr
                                var aUIMgr = req('UIMgr') ? req('UIMgr').UIMgr.inst : null;
                                var viewsClose = [
                                    'ActivityFengyunCopyTowerFightResultView',
                                    'ActivityFengyunCopyEquipReplaceView',
                                    'ActivityFengyunCopyEquipGainView',
                                    'ActivityFengyunCopyBreakResultView',
                                    'ActivityFengyunCopyUpLevelView',
                                    'ActivityFengyunCopyTrialAchieveView'
                                ];
                                for (var vc = 0; vc < viewsClose.length; vc++) {
                                    try {
                                        var vm = req(viewsClose[vc]);
                                        var vcCls = vm ? (vm[viewsClose[vc]] || vm.default) : null;
                                        if (vcCls && aUIMgr) aUIMgr.close(vcCls);
                                    } catch(e) {}
                                }
                                if (aUIMgr) aUIMgr.showUnderView();

                                window.__volam_unified_res = JSON.stringify({
                                    success: true,
                                    forgedCount: forgedCount,
                                    replacedCount: replacedCount,
                                    levelUps: levelUps,
                                    curLev: curLev,
                                    claimedTrialCount: claimedTrialCount
                                });
                                window.__volam_unified_done = true;

                            } catch(err) {
                                window.__volam_unified_res = JSON.stringify({ error: err.toString() });
                                window.__volam_unified_done = true;
                            }
                        })();

                        return "LAUNCHED";
                    } catch(e) {
                        return "ERR: " + e.toString();
                    }
                })();
}};
P.workers["vo_lam_tower"]={definition:{"id": "vo_lam_tower", "name": "Võ lâm: vượt tháp", "types": [1086], "action": "action_vo_lam_truyen_ky", "var": "js_tower_full", "result": "__volam_tower_res", "doneGlobal": "__volam_tower_done", "counters": ["chaptersPassed", "fightsWon"]},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (function() {
                    try {
                        window.__volam_tower_done = false;
                        window.__volam_tower_res = null;

                        var req = window.__require;
                        if (!req) {
                            window.__volam_tower_res = JSON.stringify({ error: "No __require" });
                            window.__volam_tower_done = true;
                            return "NO_REQ";
                        }

                        var actId = params.activityId;
                        var actMgr = req('ActivityMgr').ActivityMgr.inst;
                        var act = actMgr.getActivity(actId);
                        if (!act) {
                            window.__volam_tower_res = JSON.stringify({ error: "No act" });
                            window.__volam_tower_done = true;
                            return "NO_ACT";
                        }

                        var mgr = req('ActivityFengyunCopyMgr').ActivityFengyunCopyMgr.inst;
                        var uiUtil = req('ActivityFengyunCopyUIUtil').ActivityFengyunCopyUIUtil;

                        function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

                        var aUIMgr = req('UIMgr') ? req('UIMgr').UIMgr.inst : null;
                        var fightResMod = req('ActivityFengyunCopyTowerFightResultView');
                        var fightResCls = fightResMod ? (fightResMod.ActivityFengyunCopyTowerFightResultView || fightResMod.default) : null;

                        function cleanPopups() {
                            try {
                                if (fightResCls && aUIMgr) aUIMgr.close(fightResCls);
                                var popViews = [
                                    'ActivityFengyunCopyTowerFightResultView',
                                    'ActivityFengyunCopyLevelBattleView',
                                    'ActivityFengyunCopyEquipReplaceView',
                                    'ActivityFengyunCopyEquipGainView',
                                    'ActivityFengyunCopyBreakResultView',
                                    'ActivityFengyunCopyUpLevelView',
                                    'ActivityFengyunCopyTrialAchieveView'
                                ];
                                for (var pv = 0; pv < popViews.length; pv++) {
                                    try {
                                        var m = req(popViews[pv]);
                                        var c = m ? (m[popViews[pv]] || m.default) : null;
                                        if (c && aUIMgr && aUIMgr.hasView && aUIMgr.hasView(c)) aUIMgr.close(c);
                                    } catch(e) {}
                                }
                                var fg = window.fgui;
                                if (fg && fg.GRoot && fg.GRoot.inst) {
                                    var root = fg.GRoot.inst;
                                    for (var i = root.numChildren - 1; i >= 0; i--) {
                                        var ch = root.getChildAt(i);
                                        if (ch && ch.visible && ch.name && (/Alert|Confirm|Dialog|Notice|Tip/i.test(ch.name))) {
                                            var btnC = ch.getChild ? (ch.getChild('btnConfirm') || ch.getChild('btnSure') || ch.getChild('btnOk') || ch.getChild('btnClose')) : null;
                                            if (btnC && typeof btnC.fireClick === 'function') {
                                                try { btnC.fireClick(true); } catch(e) {}
                                            }
                                        }
                                    }
                                }
                                if (aUIMgr) aUIMgr.showUnderView();
                            } catch(e) {}
                        }

                        (async function() {
                            try {
                                cleanPopups();
                                var chaptersPassed = 0;
                                var fightsWon = 0;
                                var stopReason = "";
                                var lastChapterName = "";

                                var maxChapters = 30; // Giới hạn kiểm tra tối đa 30 chương
                                while (maxChapters-- > 0) {
                                    var td = mgr.model.getTowerData(actId);
                                    var curC = td ? td.currentChapter : null;

                                    // Nếu chưa có chương đang mở hoặc vừa thông quan chương trước
                                    if (!curC || !curC.chapterId) {
                                        var sRes = await mgr.reqStartChapter(act, false);
                                        await sleep(350);
                                        td = mgr.model.getTowerData(actId);
                                        curC = td ? td.currentChapter : null;
                                        if (!curC || !curC.chapterId) {
                                            stopReason = "Đã hoàn thành toàn bộ các chương khả dụng";
                                            break;
                                        }
                                    }

                                    var cCfg = td.getChapterConfig(curC.chapterId);
                                    var cName = cCfg ? cCfg.name : ("Chương " + curC.chapterId);
                                    lastChapterName = cName;

                                    var chapterFailed = false;
                                    var maxSteps = 50;
                                    while (maxSteps-- > 0) {
                                        td = mgr.model.getTowerData(actId);
                                        curC = td ? td.currentChapter : null;
                                        if (!curC) break;

                                        // Khi hết sự kiện trong chương -> Nhận thưởng ủy thác và Thông quan chương
                                        if (!curC.event || curC.event.length === 0) {
                                            var tasks = curC.taskEvent || [];
                                            for (var t = 0; t < tasks.length; t++) {
                                                if (tasks[t] && tasks[t].event) {
                                                    await mgr.reqFinishTaskEvent(act, tasks[t].event);
                                                    await sleep(250);
                                                }
                                            }
                                            var pRes = await mgr.reqPassChapter(act);
                                            await sleep(400);
                                            cleanPopups();
                                            if (pRes && pRes.isOk) {
                                                chaptersPassed++;
                                            }
                                            break;
                                        }

                                        var evt = curC.event[0];
                                        var cfg = td.getEventConfig(evt.eventId);
                                        var evtType = cfg ? cfg.type : 0;
                                        var evtName = cfg ? cfg.name : ('Sự kiện ' + evt.eventId);

                                        // Di chuyển nếu khác buildId
                                        if (curC.buildId !== evt.buildId) {
                                            await mgr.reqChapterMove(act, evt.buildId);
                                            await sleep(250);
                                        }

                                        if (evtType === 1) { // 1: Chiến đấu (Fight)
                                            var fightWin = false;
                                            var fightFailures = 0;
                                            var maxRetries = 3; // Dù báo thiếu lực chiến vẫn vượt tiếp, chỉ ngừng khi thất bại 3 lần

                                            while (fightFailures < maxRetries && !fightWin) {
                                                var fightDone = false;
                                                var curWin = false;

                                                uiUtil.executeChapterFight(act, evt, false, function(isWin) {
                                                    fightDone = true;
                                                    curWin = !!isWin;
                                                });

                                                var waitCount = 70;
                                                while (!fightDone && waitCount-- > 0) {
                                                    await sleep(500);
                                                    cleanPopups();
                                                }
                                                await sleep(350);
                                                cleanPopups();

                                                if (curWin) {
                                                    fightWin = true;
                                                    fightsWon++;
                                                    break;
                                                } else {
                                                    fightFailures++;
                                                    // Nếu chưa thất bại đủ 3 lần thì tiếp tục khiêu chiến lại
                                                    if (fightFailures < maxRetries) {
                                                        await sleep(600);
                                                        cleanPopups();
                                                        td = mgr.model.getTowerData(actId);
                                                        curC = td ? td.currentChapter : null;
                                                        if (curC && curC.event && curC.event.length > 0) {
                                                            evt = curC.event[0];
                                                            if (curC.buildId !== evt.buildId) {
                                                                await mgr.reqChapterMove(act, evt.buildId);
                                                                await sleep(250);
                                                            }
                                                        }
                                                    }
                                                }
                                            }

                                            if (!fightWin) {
                                                chapterFailed = true;
                                                stopReason = "Đã khiêu chiến 3 lần thất bại tại " + evtName + " (" + cName + ")";
                                                break;
                                            }
                                        } else if (evtType === 2) { // 2: Lựa chọn (Decision)
                                            await mgr.reqFinishSelectEvent(act, evt, 1);
                                            await sleep(250);
                                            cleanPopups();
                                        } else if (evtType === 4) { // 4: Nhiệm vụ (Task)
                                            await mgr.reqAcceptTaskEvent(act, evt);
                                            await sleep(250);
                                            cleanPopups();
                                        } else { // 3: Kỳ ngộ, 5: Cốt truyện
                                            await mgr.reqFinishNormalEvent(act, evt);
                                            await sleep(250);
                                            cleanPopups();
                                        }
                                        await sleep(250);
                                    }

                                    if (chapterFailed) {
                                        break;
                                    }
                                }

                                // Đóng sạch sẽ các view liên quan đến Võ Lâm an toàn qua UIMgr
                                try {
                                    var allViewsClose = [
                                        'ActivityFengyunCopyTowerFightResultView',
                                        'ActivityFengyunCopyEquipReplaceView',
                                        'ActivityFengyunCopyEquipGainView',
                                        'ActivityFengyunCopyBreakResultView',
                                        'ActivityFengyunCopyUpLevelView',
                                        'ActivityFengyunCopyTrialAchieveView',
                                        'ActivityFengyunCopyLevelBattleView',
                                        'ActivityFengyunCopyStageView',
                                        'ActivityFengyunCopyMainView'
                                    ];
                                    for (var av = 0; av < allViewsClose.length; av++) {
                                        try {
                                            var avMod = req(allViewsClose[av]);
                                            var avCls = avMod ? (avMod[allViewsClose[av]] || avMod.default) : null;
                                            if (avCls && aUIMgr) aUIMgr.close(avCls);
                                        } catch(e) {}
                                    }
                                    if (aUIMgr) aUIMgr.showUnderView();

                                    // Đảm bảo phục hồi hiển thị khung cảnh chính
                                    var entry = fgui.GRoot.inst.getChild('Entry') || fgui.GRoot.inst.getChildAt(0);
                                    var content = entry ? entry.getChild('content') : null;
                                    if (content) {
                                        var sc = content.getChild('layScene');
                                        var scr = content.getChild('layScreen');
                                        if (sc && sc.numChildren > 0) {
                                            for (var si = 0; si < sc.numChildren; si++) sc.getChildAt(si).visible = true;
                                        }
                                        if (scr && scr.numChildren > 0) {
                                            for (var sri = 0; sri < scr.numChildren; sri++) scr.getChildAt(sri).visible = true;
                                        }
                                    }
                                    if (aUIMgr) aUIMgr.showUnderView();
                                } catch(e) {}

                                window.__volam_tower_res = JSON.stringify({
                                    success: true,
                                    chaptersPassed: chaptersPassed,
                                    fightsWon: fightsWon,
                                    stopReason: stopReason,
                                    lastChapter: lastChapterName
                                });
                                window.__volam_tower_done = true;

                            } catch(err) {
                                window.__volam_tower_res = JSON.stringify({ error: err.toString() });
                                window.__volam_tower_done = true;
                            }
                        })();

                        return "LAUNCHED";
                    } catch(e) {
                        return "ERR: " + e.toString();
                    }
                })();
}};
P.workers["nghe_thuat_dan_gian"]={definition:{"id": "nghe_thuat_dan_gian", "name": "Nghệ thuật dân gian", "types": [1038], "action": "action_nghe_thuat_dan_gian", "var": "js_folk_run", "result": "__folk_exec", "counters": ["used"], "limit": 150},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (function() {
                        let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                        let req = g.__require || (typeof __require !== 'undefined' ? __require : null);
                        if (!req) return JSON.stringify({err: "no_require"});
                        let gnu = req('GameNetUtil');
                        if (gnu && gnu.GameNetUtil) gnu = gnu.GameNetUtil;
                        let proto = req('Protocol');
                        if (proto && proto.Protocol) proto = proto.Protocol;
                        let BM = req('BagMgr') && (req('BagMgr').inst || req('BagMgr').BagMgr.inst);
                        
                        function getTickets() {
                            if (!BM || !BM.model || !BM.model.itemDict) return 0;
                            let it = BM.model.itemDict[120170];
                            return it ? (it.num || it.count || 0) : 0;
                        }

                        g.__folk_exec = {};
                        (async () => {
                            try {
                                let actId = params.activityId;
                                let info = await gnu.syncSeqSendMsg(proto.S_CANTON_INFO, {activityId: actId});
                                let tickets = getTickets();
                                let totalUsed = 0;
                                while (tickets > 0 && totalUsed < params.limit) {
                                    let r = await gnu.syncSeqSendMsg(proto.S_CANTON_TRAVEL, {activityId: actId, count: 1});
                                    if (r && r.ret === 0) {
                                        totalUsed++;
                                        tickets = getTickets();
                                    } else {
                                        break;
                                    }
                                }
                                
                                // Nhận thưởng sự kiện mốc nếu có
                                info = await gnu.syncSeqSendMsg(proto.S_CANTON_INFO, {activityId: actId});
                                if (info && info.event) {
                                    for (let ev of info.event) {
                                        if (!ev.gained && ev.id) {
                                            await gnu.syncSeqSendMsg(proto.S_CANTON_GET_EVENT_REWARD, {activityId: actId, eventId: [ev.id]});
                                        }
                                    }
                                }
                                
                                // Đóng popup quà tặng nếu có
                                try {
                                    let ui = req('UIMgr').UIMgr.inst;
                                    let dict = ui._viewDict || ui.viewDict || {};
                                    for (let k in dict) {
                                        let v = dict[k];
                                        if (v && v.cacheClassName && (v.cacheClassName.includes('Reward') || v.cacheClassName.includes('Canton'))) {
                                            try { v.closeSelf ? v.closeSelf() : ui.closeView(v); } catch(eC) {}
                                        }
                                    }
                                } catch(e) {}

                                g.__folk_exec = {
                                    ok: true,
                                    used: totalUsed,
                                    ticketsLeft: tickets,
                                    score: info ? (info.score || 0) : 0
                                };
                            } catch(e) {
                                g.__folk_exec = {ok: false, err: String(e)};
                            }
                        })();
                        return "started";
                    })();
}};
P.workers["di_tich_tu_linh"]={definition:{"id": "di_tich_tu_linh", "name": "Di tích tứ linh", "types": [1074], "action": "action_di_tich_tu_linh", "var": "js_tl_run", "result": "__tl_exec", "counters": ["steps", "events"], "limit": 250},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (function() {
                        let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                        let req = g.__require || (typeof __require !== 'undefined' ? __require : null);
                        if (!req) return JSON.stringify({err: "no_require"});
                        let gnu = req('GameNetUtil');
                        if (gnu && gnu.GameNetUtil) gnu = gnu.GameNetUtil;
                        let proto = req('Protocol');
                        if (proto && proto.Protocol) proto = proto.Protocol;

                        g.__tl_exec = {};
                        (async () => {
                            try {
                                let actId = params.activityId;
                                let info = await gnu.syncSeqSendMsg(proto.S_REMAINS_INFO, {activityId: actId});
                                if (!info || info.ret !== 0) {
                                    g.__tl_exec = {ok: false, err: "info_failed"};
                                    return;
                                }

                                let energy = 0;
                                async function handleEvent(ev) {
                                    let handled = 0;
                                    if (!ev) return handled;
                                    // 1. Thẻ lật bài Mật Thất (drawCard): Lật sạch các thẻ chưa mở cho đến khi hoàn thành
                                    if (ev.drawCard && ev.drawCard.length > 0) {
                                        let curEv = ev;
                                        while (curEv && curEv.drawCard) {
                                            let unrevealed = curEv.drawCard.find(c => c.state === 0);
                                            if (!unrevealed) break;
                                            let drawRes = await gnu.syncSeqSendMsg(proto.S_REMAINS_HANDLE_DRAW, {activityId: actId, order: unrevealed.order});
                                            handled++;
                                            if (drawRes && drawRes.ret === 0) {
                                                if (drawRes.event) curEv = drawRes.event;
                                                else break;
                                            } else {
                                                break;
                                            }
                                        }
                                    }
                                    // 2. Khiêu chiến quái
                                    if (ev.monster) {
                                        await gnu.syncSeqSendMsg(proto.S_REMAINS_HANDLE_MONSTER, {activityId: actId, type: 1});
                                        handled++;
                                    }
                                    // 3. Xử lý bẫy: Mặc định tiêu tốn thể lực để vùng vẫy thoát bẫy ngay lập tức (CastOff = 0)
                                    if (ev.trapTime || ev.trap || ev.type === 8 || ev.tileType === 8) {
                                        let trapRes = await gnu.syncSeqSendMsg(proto.S_REMAINS_HANDLE_TRAP, {activityId: actId, type: 0});
                                        handled++;
                                        if (trapRes && trapRes.ret === 0) {
                                            try {
                                                let reInfo = await gnu.syncSeqSendMsg(proto.S_REMAINS_INFO, {activityId: actId});
                                                if (reInfo && reInfo.energy !== undefined && reInfo.energy !== null) {
                                                    energy = reInfo.energy;
                                                }
                                            } catch(e) {}
                                        }
                                    }
                                    return handled;
                                }

                                let events = 0;
                                // Xử lý sự kiện còn dang dở từ trước nếu có
                                if (info.event) {
                                    events += await handleEvent(info.event);
                                }
                                if (info.remainEvent) {
                                    events += await handleEvent(info.remainEvent);
                                }

                                // Nhận thể lực miễn phí nếu có
                                try {
                                    await gnu.syncSeqSendMsg(proto.S_REMAINS_GAIN_ENERGY, {activityId: actId});
                                } catch(e) {}

                                // Đọc lại dữ liệu sau khi giải phóng sự kiện tồn
                                info = await gnu.syncSeqSendMsg(proto.S_REMAINS_INFO, {activityId: actId});
                                energy = info.energy || 0;
                                let steps = 0;

                                while (energy > 0 && steps < params.limit) {
                                    let isSecret = !!(info.secret && info.secret.cell && info.secret.cell.length > 0);
                                    let rollRes = await gnu.syncSeqSendMsg(proto.S_REMAINS_ROLL, {activityId: actId, appoint: 0, secret: isSecret});
                                    if (rollRes && rollRes.ret === 0) {
                                        steps++;
                                        energy = (rollRes.energy !== undefined && rollRes.energy !== null) ? rollRes.energy : Math.max(0, energy - 1);
                                        if (rollRes.event && rollRes.event.length > 0) {
                                            for (let ev of rollRes.event) {
                                                events += await handleEvent(ev);
                                                if (ev.secret) info.secret = ev.secret;
                                            }
                                        }
                                    } else if (rollRes && rollRes.ret === 10178) {
                                        // Đảo cờ bí cảnh nếu trạng thái lệch và thử lại
                                        let rollRes2 = await gnu.syncSeqSendMsg(proto.S_REMAINS_ROLL, {activityId: actId, appoint: 0, secret: !isSecret});
                                        if (rollRes2 && rollRes2.ret === 0) {
                                            steps++;
                                            energy = (rollRes2.energy !== undefined && rollRes2.energy !== null) ? rollRes2.energy : Math.max(0, energy - 1);
                                            if (rollRes2.event && rollRes2.event.length > 0) {
                                                for (let ev of rollRes2.event) {
                                                    events += await handleEvent(ev);
                                                    if (ev.secret) info.secret = ev.secret;
                                                }
                                            }
                                        } else if (rollRes2 && rollRes2.ret === 10179) {
                                            energy = 0;
                                            break;
                                        } else {
                                            break;
                                        }
                                    } else if (rollRes && rollRes.ret === 10179) {
                                        // Mã lỗi 10179: Hết thể lực chính thức từ máy chủ
                                        energy = 0;
                                        break;
                                    } else {
                                        // Thử giải cứu nếu đang bị kẹt bẫy ngoài luồng
                                        try {
                                            let rescueTrap = await gnu.syncSeqSendMsg(proto.S_REMAINS_HANDLE_TRAP, {activityId: actId, type: 0});
                                            if (rescueTrap && rescueTrap.ret === 0) {
                                                events++;
                                                let reInfo = await gnu.syncSeqSendMsg(proto.S_REMAINS_INFO, {activityId: actId});
                                                if (reInfo && reInfo.energy !== undefined && reInfo.energy !== null) {
                                                    energy = reInfo.energy;
                                                }
                                                continue;
                                            }
                                        } catch(e) {}
                                        break;
                                    }
                                }

                                // Nhận thành tựu công hội nếu có
                                try {
                                    await gnu.syncSeqSendMsg(proto.S_REMAINS_GAIN_UNION_ACHIEVEMENT, {activityId: actId});
                                } catch(e) {}

                                // Đóng giao diện modal Mật Thất / Quà nếu còn mở
                                try {
                                    let ui = req('UIMgr').UIMgr.inst;
                                    let dict = ui._viewDict || ui.viewDict || {};
                                    for (let k in dict) {
                                        let v = dict[k];
                                        if (v && v.cacheClassName && (
                                            v.cacheClassName.includes('DrawView') ||
                                            v.cacheClassName.includes('RelicEvent') ||
                                            v.cacheClassName.includes('Reward')
                                        )) {
                                            try { v.closeSelf ? v.closeSelf() : ui.closeView(v); } catch(eClose) {}
                                        }
                                    }
                                } catch(e) {}

                                // Đọc lại dữ liệu thật cuối cùng từ server
                                let finalInfo = await gnu.syncSeqSendMsg(proto.S_REMAINS_INFO, {activityId: actId});
                                let finalEnergy = (finalInfo && finalInfo.energy !== undefined && finalInfo.energy !== null) ? finalInfo.energy : 0;

                                g.__tl_exec = {
                                    ok: true,
                                    steps: steps,
                                    events: events,
                                    energyLeft: finalEnergy
                                };
                            } catch(e) {
                                g.__tl_exec = {ok: false, err: String(e)};
                            }
                        })();
                        return "started";
                    })();
}};
P.workers["cong_vien_ki_thu"]={definition:{"id": "cong_vien_ki_thu", "name": "Công viên kỳ thú", "types": [1075], "action": "action_cong_vien_ki_thu", "var": "js_park_run", "result": "__park_exec", "counters": ["moves"], "limit": 150},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (function() {
                        let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                        let req = g.__require || (typeof __require !== 'undefined' ? __require : null);
                        if (!req) return JSON.stringify({err: "no_require"});
                        let gnu = req('GameNetUtil');
                        if (gnu && gnu.GameNetUtil) gnu = gnu.GameNetUtil;
                        let proto = req('Protocol');
                        if (proto && proto.Protocol) proto = proto.Protocol;

                        g.__park_exec = {};
                        (async () => {
                            try {
                                let actId = params.activityId;
                                let data = await gnu.syncSeqSendMsg(proto.S_FUNPARK_DATA, {activityId: actId});
                                if (!data || data.ret !== 0) {
                                    g.__park_exec = {ok: false, err: "data_failed"};
                                    return;
                                }
                                let power = data.power || 0;
                                let modes = data.modes || [1];
                                let curMode = 1;
                                if (modes.includes(16)) curMode = 16;
                                else if (modes.includes(8)) curMode = 8;

                                function checkMatch(g, x, y) {
                                    let v = g[x + ',' + y];
                                    if (!v) return false;
                                    if (g[(x-1) + ',' + y] === v && g[(x+1) + ',' + y] === v) return true;
                                    if (g[(x-2) + ',' + y] === v && g[(x-1) + ',' + y] === v) return true;
                                    if (g[(x+1) + ',' + y] === v && g[(x+2) + ',' + y] === v) return true;
                                    if (g[x + ',' + (y-1)] === v && g[x + ',' + (y+1)] === v) return true;
                                    if (g[x + ',' + (y-2)] === v && g[x + ',' + (y-1)] === v) return true;
                                    if (g[x + ',' + (y+1)] === v && g[x + ',' + (y+2)] === v) return true;
                                    return false;
                                }

                                let moves = 0;
                                while (power > 0 && moves < params.limit) {
                                    let store = data.store && data.store.store && data.store.store[0];
                                    let blocks = store ? store.board.block : [];
                                    let grid = {};
                                    for (let b of blocks) grid[b.pos.x + ',' + b.pos.y] = b.occupation;

                                    let found = null;
                                    for (let x = 1; x <= 6; x++) {
                                        for (let y = 1; y <= 7; y++) {
                                            let neighbors = [[x+1, y], [x, y+1]];
                                            for (let n of neighbors) {
                                                let nx = n[0], ny = n[1];
                                                if (nx <= 6 && ny <= 7) {
                                                    let v1 = grid[x + ',' + y];
                                                    let v2 = grid[nx + ',' + ny];
                                                    if (v1 && v2 && v1 !== v2) {
                                                        grid[x + ',' + y] = v2;
                                                        grid[nx + ',' + ny] = v1;
                                                        if (checkMatch(grid, x, y) || checkMatch(grid, nx, ny)) {
                                                            found = {first: {x: x, y: y}, second: {x: nx, y: ny}};
                                                            grid[x + ',' + y] = v1;
                                                            grid[nx + ',' + ny] = v2;
                                                            break;
                                                        }
                                                        grid[x + ',' + y] = v1;
                                                        grid[nx + ',' + ny] = v2;
                                                    }
                                                }
                                            }
                                            if (found) break;
                                        }
                                        if (found) break;
                                    }

                                    if (found) {
                                        let moveRes = await gnu.syncSeqSendMsg(proto.S_FUN_PARK_STORE_MOVE, {
                                            activityId: actId,
                                            first: found.first,
                                            second: found.second,
                                            mode: curMode
                                        });
                                        if (moveRes && moveRes.ret === 0) {
                                            moves++;
                                            power = moveRes.power !== undefined ? moveRes.power : (power - curMode);
                                            data = await gnu.syncSeqSendMsg(proto.S_FUNPARK_DATA, {activityId: actId});
                                        } else {
                                            break;
                                        }
                                    } else {
                                        break;
                                    }
                                }

                                // Nhận các mốc thưởng tiến độ
                                for (let s = 1; s <= 14; s++) {
                                    try {
                                        await gnu.syncSeqSendMsg(proto.S_FUN_PARK_STORE_FINISH_ACTION, {activityId: actId, step: s});
                                    } catch(e) {}
                                }

                                // Đóng các popup nhận quà nếu có
                                try {
                                    let ui = req('UIMgr').UIMgr.inst;
                                    let dict = ui._viewDict || ui.viewDict || {};
                                    for (let k in dict) {
                                        let v = dict[k];
                                        if (v && v.cacheClassName && (v.cacheClassName.includes('Reward') || v.cacheClassName.includes('FunPark'))) {
                                            try { v.closeSelf ? v.closeSelf() : ui.closeView(v); } catch(eC) {}
                                        }
                                    }
                                } catch(e) {}

                                // Đọc lại dữ liệu thật cuối cùng từ máy chủ
                                let finalData = await gnu.syncSeqSendMsg(proto.S_FUNPARK_DATA, {activityId: actId});
                                let finalPower = (finalData && finalData.power !== undefined && finalData.power !== null) ? finalData.power : power;

                                g.__park_exec = {
                                    ok: true,
                                    moves: moves,
                                    mode: curMode,
                                    powerLeft: finalPower
                                };
                            } catch(e) {
                                g.__park_exec = {ok: false, err: String(e)};
                            }
                        })();
                        return "started";
                    })();
}};
P.workers["vo_hau_khai_quoc"]={definition:{"id": "vo_hau_khai_quoc", "name": "Võ hậu khai quốc", "types": [1053], "action": "action_vo_hau_khai_quoc", "var": "js_wzt_code", "result": "__wzt_result", "counters": ["battlesDone", "quickBattles", "totalUpgrades", "freeShopClaimed", "warfareClaimed"], "limit": 40},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (function() {
                let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                let req = g.__require || (typeof __require !== 'undefined' ? __require : null);
                if (!req) return JSON.stringify({err: "no_require"});
                let wztMgr = req('ActivityWuzetianMgr') ? req('ActivityWuzetianMgr').ActivityWuzetianMgr.inst : null;
                let wztNet = req('ActivityWuzetianNetUtil') ? (req('ActivityWuzetianNetUtil').activityWuzetianNetUtil || req('ActivityWuzetianNetUtil').default) : null;
                let gnu = req('GameNetUtil') ? req('GameNetUtil').GameNetUtil : null;
                let proto = req('Protocol') ? req('Protocol').Protocol : null;
                let actId = params.activityId;

                if (!wztMgr && !wztNet && !gnu) return JSON.stringify({err: "no_modules"});

                g.__wzt_result = null;
                (async () => {
                    try {
                        if ((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested)) {
                            g.__wzt_result = { ok: true, battlesDone: 0, highestChapter: 0, powerLeft: 0, stopped: true };
                            return;
                        }
                        let uiMgr = req('UIMgr') ? req('UIMgr').UIMgr.inst : null;
                        let toastView = req('ToastConfirmView') ? req('ToastConfirmView').ToastConfirmView : null;
                        if (uiMgr && toastView) {
                            try { if (uiMgr.isViewOpen(toastView)) uiMgr.close(toastView); } catch(e){}
                        }

                        if (wztMgr) {
                            await wztMgr.reqConfig(actId);
                            await wztMgr.reqInfo(actId);
                        } else if (gnu && proto) {
                            await gnu.syncSeqSendMsg(proto.S_WUZETIAN_CONFIG, {activityId: actId});
                            await gnu.syncSeqSendMsg(proto.S_WUZETIAN_INFO, {activityId: actId});
                        }

                        // Nhận quà ngày miễn phí tại Tiệm Võ Hậu Khai Quốc
                        let freeShopClaimed = 0;
                        try {
                            let act = req('ActivityMgr') ? req('ActivityMgr').ActivityMgr.inst.getActivity(actId) : null;
                            let snu = req('ShopNetUtil') ? req('ShopNetUtil').ShopNetUtil : null;
                            let sm = req('ShopMgr') ? req('ShopMgr').ShopMgr.inst : null;
                            let mall = (act && act.mallDict) ? act.mallDict : {};
                            for (let mid in mall) {
                                let it = mall[mid];
                                if (it && !(it.rechargeId > 0)) {
                                    let p = Number(it.price || 0);
                                    if (p === 0 || it.isFree) {
                                        let goodsId = Number(it.mallId || mid);
                                        let bCount = sm ? sm.getShopBuyGoodsCount(goodsId) : 0;
                                        let bLimit = Number(it.buyLimit || 1);
                                        if (bLimit === -1 || bCount < bLimit) {
                                            if (snu && typeof snu.buyGoods === 'function') {
                                                let bRes = await snu.buyGoods(goodsId, 1);
                                                if (bRes && bRes.ret === 0) freeShopClaimed++;
                                            }
                                        }
                                    }
                                }
                            }
                        } catch(e) {}

                        // Nhận mốc thưởng Quốc Khố (Chiến Lệnh / Warfare Order)
                        let warfareClaimed = false;
                        try {
                            if (gnu && proto) {
                                await gnu.syncSeqSendMsg(proto.S_ACTIVITY_WARFARE_ORDER_INFO, {activityId: actId});
                                let cRes = await gnu.syncSeqSendMsg(proto.S_ACTIVITY_GET_WARFARE_ORDER_REWARD, {activityId: actId});
                                if (cRes && cRes.ret === 0) warfareClaimed = true;
                            }
                        } catch(e) {}

                        // Xử lý ải dở dang ban đầu: xóa sạch popup và reset trạng thái dở dang
                        let initActData = wztMgr ? wztMgr.getActData(actId) : null;
                        if (initActData && initActData.playerInfo) {
                            let pInfo = initActData.playerInfo;
                            if (pInfo.board != null || pInfo.hasUncompleteBattle) {
                                try {
                                    if (wztMgr) await wztMgr.endBattle(actId);
                                    else if (wztNet) await wztNet.end(actId);
                                } catch(e) {}
                                pInfo.board = undefined;
                                pInfo.hasUncompleteBattle = false;
                                if (wztMgr) await wztMgr.reqInfo(actId);
                            }
                        }
                        if (uiMgr && toastView) {
                            try { if (uiMgr.isViewOpen(toastView)) uiMgr.close(toastView); } catch(e){}
                        }

                        // DANH SÁCH 3 QUAN LẠI CHỦ LỰC THEO YÊU CẦU:
                        // 104: Lý Bạch (LiBai)
                        // 105: Tôn Tư Mạc (SunSiMiao)
                        // 102: Tô Định Phương (SuDingFang)
                        const TARGET_MINISTER_IDS = [104, 105, 102];

                        async function upgradeMinisters() {
                            let cnt = 0;
                            if (!wztMgr) return 0;
                            let actData = wztMgr.getActData(actId);
                            let cfgData = wztMgr.getConfigData(actId);
                            if (!actData || !actData.playerInfo || !actData.playerInfo.minister) return 0;
                            let bagMgr = req('BagMgr') ? req('BagMgr').BagMgr.inst : null;
                            let act = req('ActivityMgr') ? req('ActivityMgr').ActivityMgr.inst.getActivity(actId) : null;
                            let uUtil = req('ActivityWuzetianUtil') ? req('ActivityWuzetianUtil').ActivityWuzetianUtil : null;
                            let expItemId = (uUtil && act) ? uUtil.getMinisterExpItemId(act) : 0;

                            for (let loop = 0; loop < 100; loop++) {
                                if ((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested)) break;
                                // CHỈ DỒN EXP NÂNG CHO: Lý Bạch (104), Tôn Tư Mạc (105), Tô Định Phương (102)
                                let ministers = actData.playerInfo.minister.filter(m => TARGET_MINISTER_IDS.includes(m.id));
                                if (ministers.length === 0) break;

                                // Ưu tiên tướng có cấp thấp nhất trong 3 tướng để nâng đều cả 3
                                // Nếu cùng cấp thì ưu tiên: Lý Bạch (104) -> Tôn Tư Mạc (105) -> Tô Định Phương (102)
                                ministers.sort((a, b) => {
                                    if (a.level !== b.level) return a.level - b.level;
                                    return TARGET_MINISTER_IDS.indexOf(a.id) - TARGET_MINISTER_IDS.indexOf(b.id);
                                });

                                let candidate = null;
                                for (let m of ministers) {
                                    let lvList = (cfgData.getLevelConfigListByMinisterId(m.id) || []).concat();
                                    lvList.sort((x, y) => x.level - y.level);
                                    let curCfg = lvList.find(x => x.level === m.level);
                                    let cost = curCfg ? curCfg.cost : 0;
                                    if (cost > 0 && bagMgr && expItemId) {
                                        let own = bagMgr.getOwnCount(expItemId);
                                        if (own >= cost) {
                                            candidate = m;
                                            break;
                                        }
                                    }
                                }
                                if (!candidate) break;
                                let res = await wztMgr.reqMinisterLevelUp(actId, candidate.id, 1);
                                if (res && res.ret === 0) cnt++;
                                else break;
                            }
                            return cnt;
                        }

                        if ((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested)) {
                            g.__wzt_result = { ok: true, battlesDone: 0, highestChapter: 0, powerLeft: 0, stopped: true };
                            return;
                        }

                        let totalUpgrades = await upgradeMinisters();
                        let battlesDone = 0;
                        let quickBattles = 0;
                        let normalBattles = 0;
                        let highestChapter = 0;
                        let powerLeft = 0;
                        let consecutiveLosses = 0;

                        function checkMatch(b, r, c) {
                            let v = b[r] && b[r][c] ? b[r][c].occupation : 0;
                            if (!v || v === 9 || v === 10) return false;
                            if (c >= 2 && b[r][c-1].occupation === v && b[r][c-2].occupation === v) return true;
                            if (c <= 4 && b[r][c+1].occupation === v && b[r][c+2].occupation === v) return true;
                            if (c >= 1 && c <= 5 && b[r][c-1].occupation === v && b[r][c+1].occupation === v) return true;
                            if (r >= 2 && b[r-1][c].occupation === v && b[r-2][c].occupation === v) return true;
                            if (r <= 3 && b[r+1][c].occupation === v && b[r+2][c].occupation === v) return true;
                            if (r >= 1 && r <= 4 && b[r-1][c].occupation === v && b[r+1][c].occupation === v) return true;
                            return false;
                        }

                        for (let bIndex = 0; bIndex < params.limit; bIndex++) {
                            if ((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested)) {
                                break;
                            }
                            let actData = wztMgr ? wztMgr.getActData(actId) : null;
                            let cfgData = wztMgr ? wztMgr.getConfigData(actId) : null;
                            if (!actData || !actData.playerInfo || !cfgData) break;

                            let pInfo = actData.playerInfo;
                            powerLeft = pInfo.power || 0;
                            let curChap = pInfo.chapterId || 1;
                            let chapCfg = cfgData.getChapterConfig(curChap);
                            if (!chapCfg) break;

                            let reqEnergy = chapCfg.energy || 5;
                            if (powerLeft < reqEnergy) break;

                            let curScore = pInfo.calculatedTotalScore || 0;
                            let skipScore = chapCfg.skipPower || 999999999;

                            // 1. Thử Vượt Nhanh (Fast Pass)
                            if (curScore >= skipScore) {
                                actData.quickBattleSelect = true;
                                let qRes = await wztMgr.reqChallengeCheckQuickBattle(actId);
                                if (qRes && qRes.ret === 0) {
                                    battlesDone++;
                                    quickBattles++;
                                    highestChapter = curChap;
                                    consecutiveLosses = 0;
                                    let uCount = await upgradeMinisters();
                                    totalUpgrades += uCount;
                                    if (wztMgr) await wztMgr.reqInfo(actId);
                                    continue;
                                }
                            }

                            // 2. Khiêu chiến thường (Normal Match-3 Battle)
                            let normRes = await wztMgr.reqChallenge(actId, false);
                            if (!normRes || normRes.ret !== 0) {
                                break;
                            }

                            battlesDone++;
                            normalBattles++;

                            let wonThisBattle = false;
                            for (let step = 0; step < 80; step++) {
                                if ((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested)) {
                                    break;
                                }
                                let enemies = (wztMgr.getBattleEnemies(actId) || []).filter(e => e.isAlive);
                                if (enemies.length === 0) {
                                    wonThisBattle = true;
                                    break;
                                }

                                let ministers = (wztMgr.getBattleMinisters(actId) || []).filter(m => m.isAlive);
                                if (ministers.length === 0) {
                                    wonThisBattle = false;
                                    break;
                                }

                                // 2.1 Kích hoạt kỹ năng đúng mục tiêu:
                                let readyM = ministers.filter(m => m.isEnergyFull);
                                for (let rm of readyM) {
                                    try {
                                        let targetEnemyId = 0;
                                        if (rm.id === 104) { // Lý Bạch: dồn sát thương cực đại vào kẻ địch nhiều máu nhất
                                            let maxBlood = -1;
                                            for (let en of enemies) {
                                                if (en.curBlood > maxBlood) {
                                                    maxBlood = en.curBlood;
                                                    targetEnemyId = en.id;
                                                }
                                            }
                                        }
                                        if (wztMgr && wztMgr.useSkill) {
                                            await wztMgr.useSkill(actId, rm.id, targetEnemyId, null);
                                        } else if (wztNet) {
                                            await wztNet.useSkill(actId, rm.id, targetEnemyId);
                                        }
                                    } catch(e) {}
                                }

                                // Cập nhật lại danh sách kẻ địch sau khi dùng skill
                                enemies = (wztMgr.getBattleEnemies(actId) || []).filter(e => e.isAlive);
                                if (enemies.length === 0) {
                                    wonThisBattle = true;
                                    break;
                                }

                                let curBoard = wztMgr.getCurBoard(actId);
                                if (!curBoard) break;

                                // 2.2 Xác định tập hợp cột có quái vật còn sống
                                let targetCols = new Set();
                                for (let ae of enemies) {
                                    let lc = (ae.pos ? ae.pos.leftCol : 1) - 1;
                                    let rc = (ae.pos ? ae.pos.rightCol : 1) - 1;
                                    for (let col = lc; col <= rc; col++) targetCols.add(col);
                                }

                                // 2.3 Tìm nước đi tốt nhất
                                let moveAction = null;
                                // Ưu tiên 1: Kích hoạt bom Thập tự (10) hoặc bom Cửu cung (9)
                                for (let r = 0; r < 6; r++) {
                                    for (let c = 0; c < 7; c++) {
                                        let occ = curBoard[r][c].occupation;
                                        if (occ === 9 || occ === 10) {
                                            let dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                                            for (let d of dirs) {
                                                let nr = r + d[0], nc = c + d[1];
                                                if (nr >= 0 && nr < 6 && nc >= 0 && nc < 7) {
                                                    moveAction = {r1: r, c1: c, r2: nr, c2: nc};
                                                    break;
                                                }
                                            }
                                        }
                                        if (moveAction) break;
                                    }
                                    if (moveAction) break;
                                }

                                // Ưu tiên 2: Tìm nước hoán đổi match-3 TẬP TRUNG TỐI ĐA VÀO CỘT CÓ QUÁI
                                if (!moveAction) {
                                    let bestScore = -1;
                                    for (let r = 0; r < 6; r++) {
                                        for (let c = 0; c < 7; c++) {
                                            let neighbors = [[r+1, c], [r, c+1]];
                                            for (let nb of neighbors) {
                                                let nr = nb[0], nc = nb[1];
                                                if (nr < 6 && nc < 7) {
                                                    let occ1 = curBoard[r][c].occupation;
                                                    let occ2 = curBoard[nr][nc].occupation;
                                                    if (occ1 && occ2 && occ1 !== occ2) {
                                                        curBoard[r][c].occupation = occ2;
                                                        curBoard[nr][nc].occupation = occ1;
                                                        let mCount = 0;
                                                        let enemyColHit = 0;
                                                        if (checkMatch(curBoard, r, c)) {
                                                            mCount++;
                                                            if (targetCols.has(c)) enemyColHit += 1000;
                                                        }
                                                        if (checkMatch(curBoard, nr, nc)) {
                                                            mCount++;
                                                            if (targetCols.has(nc)) enemyColHit += 1000;
                                                        }
                                                        curBoard[r][c].occupation = occ1;
                                                        curBoard[nr][nc].occupation = occ2;
                                                        if (mCount > 0) {
                                                            let s = enemyColHit + mCount * 10;
                                                            if (s > bestScore) {
                                                                bestScore = s;
                                                                moveAction = {r1: r, c1: c, r2: nr, c2: nc};
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                if (moveAction) {
                                    let b1 = { row: moveAction.r1, column: moveAction.c1, serverX: moveAction.r1 + 1, serverY: moveAction.c1 + 1, isBlockValid: true };
                                    let b2 = { row: moveAction.r2, column: moveAction.c2, serverX: moveAction.r2 + 1, serverY: moveAction.c2 + 1, isBlockValid: true };
                                    if (wztMgr && wztMgr.reqMove) {
                                        await wztMgr.reqMove(actId, b1, b2, null);
                                    } else if (wztNet) {
                                        await wztNet.move(actId, b1.serverX, b1.serverY, b2.serverX, b2.serverY);
                                    }

                                    let bInfo = wztMgr ? (wztMgr.getActData(actId) ? wztMgr.getActData(actId).battleInfo : null) : null;
                                    if (bInfo && bInfo.isBattleEnd()) {
                                        wonThisBattle = (wztMgr.getBattleEnemies(actId) || []).filter(e => e.isAlive).length === 0;
                                        break;
                                    }
                                } else {
                                    break;
                                }
                            }

                            // Chốt kết thúc trận đấu sạch sẽ với server (TRÁNH BỊ KẸT POPUP DỞ DANG)
                            try {
                                if (wztMgr) await wztMgr.endBattle(actId);
                                else if (wztNet) await wztNet.end(actId);
                            } catch(e) {}

                            // Cập nhật lại thông tin mới nhất
                            if (wztMgr) await wztMgr.reqInfo(actId);
                            let freshAct = wztMgr ? wztMgr.getActData(actId) : null;
                            if (freshAct && freshAct.playerInfo) {
                                freshAct.playerInfo.board = undefined;
                                freshAct.playerInfo.hasUncompleteBattle = false;
                                powerLeft = freshAct.playerInfo.power || 0;
                                let newChap = freshAct.playerInfo.chapterId || 1;
                                if (newChap > curChap || wonThisBattle) {
                                    highestChapter = Math.max(highestChapter, curChap);
                                    consecutiveLosses = 0;
                                } else {
                                    consecutiveLosses++;
                                }
                            } else {
                                if (wonThisBattle) consecutiveLosses = 0;
                                else consecutiveLosses++;
                            }

                            // Sau trận, dùng tài nguyên mới tiếp tục dồn nâng cho 3 tướng chủ lực
                            let uCount = await upgradeMinisters();
                            totalUpgrades += uCount;

                            // Đóng popup ToastConfirmView nếu có bật lên
                            if (uiMgr && toastView) {
                                try { if (uiMgr.isViewOpen(toastView)) uiMgr.close(toastView); } catch(e){}
                            }

                            // Nếu thua liên tiếp 2 lần tại cùng 1 ải -> dừng lại tránh tốn thể lực
                            if (consecutiveLosses >= 2) {
                                break;
                            }
                        }

                        g.__wzt_result = {
                            ok: true,
                            battlesDone: battlesDone,
                            quickBattles: quickBattles,
                            normalBattles: normalBattles,
                            highestChapter: highestChapter,
                            totalUpgrades: totalUpgrades,
                            powerLeft: powerLeft,
                            freeShopClaimed: freeShopClaimed,
                            warfareClaimed: warfareClaimed,
                            stopped: Boolean((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested))
                        };
                    } catch(e) {
                        g.__wzt_result = {ok: false, error: e.toString()};
                    }
                })();
                return JSON.stringify({started: true});
            })();
}};
P.workers["the_gioi_dong_vat"]={definition:{"id": "the_gioi_dong_vat", "name": "Thế giới động vật", "types": [1042], "action": "action_the_gioi_dong_vat", "var": "js_am_code", "result": "__am_result", "counters": ["gamesPlayed", "illustratedClaimed", "levelUpCount", "freeShopClaimed"], "limit": 5},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (function() {
                let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                let req = g.__require || (typeof __require !== 'undefined' ? __require : null);
                if (!req) return JSON.stringify({err: "no_require"});
                let amMgr = req('ActivityAnimalMigrationMgr') ? req('ActivityAnimalMigrationMgr').ActivityAnimalMigrationMgr.inst : null;
                let amNet = req('ActivityAnimalMigrationNetUtil') ? (req('ActivityAnimalMigrationNetUtil').activityAnimalMigrationNetUtil || req('ActivityAnimalMigrationNetUtil').default) : null;
                let gnu = req('GameNetUtil') ? req('GameNetUtil').GameNetUtil : null;
                let proto = req('Protocol') ? req('Protocol').Protocol : null;
                let actId = params.activityId;

                if (!amMgr && !amNet && !gnu) return JSON.stringify({err: "no_modules"});

                g.__am_result = null;
                (async () => {
                    try {
                        if ((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested)) {
                            g.__am_result = { gamesPlayed: 0, maxScoreAchieved: 0, totalMoves: 0, stopped: true };
                            return;
                        }
                        let uiMgr = req('UIMgr') ? req('UIMgr').UIMgr.inst : null;
                        let rView = req('ActivityAnimalMigrationGameRewardView') ? req('ActivityAnimalMigrationGameRewardView').ActivityAnimalMigrationGameRewardView : null;
                        if (uiMgr && rView) {
                            try { if (uiMgr.isViewOpen(rView)) uiMgr.close(rView); } catch(e){}
                        }

                        if (amMgr) {
                            await amMgr.reqConfig(actId);
                            await amMgr.reqInfo(actId);
                        } else if (gnu && proto) {
                            await gnu.syncSeqSendMsg(proto.S_ANIMAL_WORLD_CONFIG, {activityId: actId});
                            await gnu.syncSeqSendMsg(proto.S_ANIMAL_WORLD_INFO, {activityId: actId});
                        }

                        // Nhận quà ngày miễn phí tại Tiệm Thế Giới Động Vật
                        let freeShopClaimed = 0;
                        try {
                            let act = req('ActivityMgr') ? req('ActivityMgr').ActivityMgr.inst.getActivity(actId) : null;
                            let snu = req('ShopNetUtil') ? req('ShopNetUtil').ShopNetUtil : null;
                            let sm = req('ShopMgr') ? req('ShopMgr').ShopMgr.inst : null;
                            let mall = (act && act.mallDict) ? act.mallDict : {};
                            for (let mid in mall) {
                                let it = mall[mid];
                                if (it && !(it.rechargeId > 0)) {
                                    let p = Number(it.price || 0);
                                    if (p === 0 || it.isFree) {
                                        let goodsId = Number(it.mallId || mid);
                                        let bCount = sm ? sm.getShopBuyGoodsCount(goodsId) : 0;
                                        let bLimit = Number(it.buyLimit || 1);
                                        if (bLimit === -1 || bCount < bLimit) {
                                            if (snu && typeof snu.buyGoods === 'function') {
                                                let bRes = await snu.buyGoods(goodsId, 1);
                                                if (bRes && bRes.ret === 0) freeShopClaimed++;
                                            }
                                        }
                                    }
                                }
                            }
                        } catch(e) {}

                        let illustratedClaimed = 0;
                        let levelUpCount = 0;

                        if (amMgr) {
                            let animalList = amMgr.model.getIllustratedAnimalJsons(actId) || [];
                            for (let a of animalList) {
                                if ((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested)) break;
                                let st = amMgr.getAnimalIllustratedState(actId, a.id);
                                if (st === 1) {
                                    let rRes = await amMgr.reqIllustratedReward(actId, a.id);
                                    if (rRes && rRes.ret === 0) illustratedClaimed++;
                                }
                                let curLv = amMgr.getAnimalLevel(actId, a.id, false);
                                if (!amMgr.isAnimalMaxLevel(a, curLv)) {
                                    let uRes = await amMgr.reqAnimalLevelUp(actId, a.id);
                                    if (uRes && uRes.ret === 0) levelUpCount++;
                                }
                            }
                        }

                        // Xử lý ván dở dang đã kết thúc trước đó: bấm Hủy không hồi sinh
                        if (amMgr && amMgr.model) {
                            let mData = amMgr.model.getAnimalMigrationData(actId);
                            if (mData && mData.getGameEndMsg(actId)) {
                                try {
                                    if (amNet) await amNet.reqResult(actId, false);
                                    mData.clearGameEndMsg(actId);
                                } catch(e) {}
                            }
                        }

                        let gamesPlayed = 0;
                        let maxScoreAchieved = 0;
                        let totalMoves = 0;

                        for (let gIdx = 0; gIdx < params.limit; gIdx++) {
                            if ((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested)) {
                                break;
                            }
                            let act = req('ActivityMgr') ? req('ActivityMgr').ActivityMgr.inst.getActivity(actId) : null;
                            let remainFree = (amMgr && act) ? amMgr.calcGameRemainFreeTimes(act) : 0;
                            let needCont = amMgr ? amMgr.getNormalGameNeedContinue(actId).needContinue : false;

                            // Hết lượt free và không có ván cần tiếp tục -> dừng lại (không tiêu kim cương/vé)
                            if (remainFree <= 0 && !needCont) break;

                            let sRes = await amMgr.reqStartGame(actId, needCont, false, false);
                            if (!sRes || sRes.ret !== 0) {
                                // Nếu bị kẹt ván cũ, thử bấm Hủy rồi thử lại 1 lần
                                try {
                                    if (amNet) await amNet.reqResult(actId, false);
                                    if (amMgr && amMgr.model) amMgr.model.getAnimalMigrationData(actId).clearGameEndMsg(actId);
                                    sRes = await amMgr.reqStartGame(actId, false, false, false);
                                } catch(e) {}
                                if (!sRes || sRes.ret !== 0) break;
                            }

                            gamesPlayed++;
                            if (amMgr && amMgr.model) {
                                let mData = amMgr.model.getAnimalMigrationData(actId);
                                if (mData) mData.clearGameEndMsg(actId);
                            }
                            let curBoard = sRes.board;
                            if (!curBoard && amMgr) {
                                let mData = amMgr.model.getAnimalMigrationData(actId);
                                curBoard = mData ? mData.board : null;
                            }

                            let isGameOver = false;
                            let useSkillTimes = 0;
                            let moveHistory = [];

                            // Hệ thống mô phỏng vật lý đa tầng Dropdom / Haru Slide Master AI
                            function simulateMove(chessList, movedUid, targetX) {
                                let pieces = chessList.map(c => ({
                                    uid: c.uid,
                                    x: (c.uid === movedUid) ? targetX : c.x,
                                    y: c.y,
                                    len: c.len || 1
                                }));

                                // Giai đoạn 1: Rơi tự do toàn bàn cờ (Gravity drop)
                                let dropped = true;
                                let dropLoops = 0;
                                while (dropped && dropLoops < 15) {
                                    dropped = false;
                                    dropLoops++;
                                    let grid = Array(11).fill(null).map(() => Array(9).fill(0));
                                    for (let p of pieces) {
                                        for (let dx = 0; dx < p.len; dx++) {
                                            if (p.y < 11 && (p.x + dx) < 9) grid[p.y][p.x + dx] = p.uid;
                                        }
                                    }
                                    pieces.sort((a, b) => a.y - b.y);
                                    for (let p of pieces) {
                                        if (p.y <= 0) continue;
                                        let canFall = true;
                                        for (let dx = 0; dx < p.len; dx++) {
                                            let bc = grid[p.y - 1][p.x + dx];
                                            if (bc !== 0 && bc !== p.uid) { canFall = false; break; }
                                        }
                                        if (canFall) {
                                            p.y--;
                                            dropped = true;
                                            for (let dx = 0; dx < p.len; dx++) {
                                                grid[p.y + 1][p.x + dx] = 0;
                                                grid[p.y][p.x + dx] = p.uid;
                                            }
                                        }
                                    }
                                }

                                // Giai đoạn 2: Nổ hàng & dây chuyền (Line clear & Cascade drop)
                                let totalCleared = 0;
                                let clearing = true;
                                let clearLoops = 0;
                                while (clearing && clearLoops < 6) {
                                    clearing = false;
                                    clearLoops++;
                                    let rowCounts = Array(11).fill(0);
                                    for (let p of pieces) {
                                        for (let dx = 0; dx < p.len; dx++) {
                                            if (p.y < 11) rowCounts[p.y]++;
                                        }
                                    }
                                    let fullRows = [];
                                    for (let r = 0; r < 11; r++) {
                                        if (rowCounts[r] >= 9) fullRows.push(r);
                                    }
                                    if (fullRows.length > 0) {
                                        clearing = true;
                                        totalCleared += fullRows.length;
                                        pieces = pieces.filter(p => !fullRows.includes(p.y));
                                        for (let p of pieces) {
                                            let rowsBelow = fullRows.filter(r => r < p.y).length;
                                            p.y -= rowsBelow;
                                        }
                                        // Rơi tiếp sau khi hàng nổ
                                        let dropAgain = true;
                                        let dL = 0;
                                        while (dropAgain && dL < 10) {
                                            dropAgain = false;
                                            dL++;
                                            let g = Array(11).fill(null).map(() => Array(9).fill(0));
                                            for (let p of pieces) {
                                                for (let dx = 0; dx < p.len; dx++) {
                                                    if (p.y < 11 && (p.x + dx) < 9) g[p.y][p.x + dx] = p.uid;
                                                }
                                            }
                                            pieces.sort((a, b) => a.y - b.y);
                                            for (let p of pieces) {
                                                if (p.y <= 0) continue;
                                                let canFall = true;
                                                for (let dx = 0; dx < p.len; dx++) {
                                                    let bc = g[p.y - 1][p.x + dx];
                                                    if (bc !== 0 && bc !== p.uid) { canFall = false; break; }
                                                }
                                                if (canFall) {
                                                    p.y--;
                                                    dropAgain = true;
                                                    for (let dx = 0; dx < p.len; dx++) {
                                                        g[p.y + 1][p.x + dx] = 0;
                                                        g[p.y][p.x + dx] = p.uid;
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                let finalRowCounts = Array(11).fill(0);
                                let finalColHeights = Array(9).fill(0);
                                let finalGrid = Array(11).fill(null).map(() => Array(9).fill(0));
                                for (let p of pieces) {
                                    for (let dx = 0; dx < p.len; dx++) {
                                        if (p.y < 11 && (p.x + dx) < 9) {
                                            finalGrid[p.y][p.x + dx] = p.uid;
                                            finalRowCounts[p.y]++;
                                            finalColHeights[p.x + dx] = Math.max(finalColHeights[p.x + dx], p.y + 1);
                                        }
                                    }
                                }
                                let maxH = Math.max(0, ...finalColHeights);
                                let holes = 0;
                                for (let c = 0; c < 9; c++) {
                                    let blockSeen = false;
                                    for (let r = 10; r >= 0; r--) {
                                        if (finalGrid[r][c] !== 0) blockSeen = true;
                                        else if (blockSeen) holes++;
                                    }
                                }
                                return {
                                    linesCleared: totalCleared,
                                    maxH: maxH,
                                    holes: holes,
                                    rowCounts: finalRowCounts,
                                    piecesLeft: pieces.length
                                };
                            }

                            for (let moveStep = 0; moveStep < 250; moveStep++) {
                                if ((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested)) {
                                    break;
                                }
                                if (isGameOver) break;

                                let chess = curBoard ? (curBoard.chess || []) : [];
                                if (chess.length === 0) {
                                    let erRes = await amMgr.reqEndRound(actId, false);
                                    if (erRes && erRes.ret === 0) {
                                        curBoard = erRes.boardInfo;
                                        continue;
                                    } else break;
                                }

                                // 1. Kích hoạt kỹ năng phá hủy khi đầy nộ và có thú ở tầng cao
                                let sEnergy = curBoard.skillEnergy || 0;
                                let energyInfo = (amMgr && act) ? amMgr.calcActivityEnergy(act, useSkillTimes) : [1000];
                                let eReq = (energyInfo && energyInfo[0]) ? energyInfo[0] : 1000;
                                if (sEnergy >= eReq && chess.length > 0) {
                                    let sortedByY = chess.slice().sort((a, b) => b.y - a.y);
                                    let topChess = sortedByY[0];
                                    if (topChess && topChess.y >= 7) {
                                        try {
                                            let skRes = await amNet.reqUseSkill(actId, topChess.uid, false, false);
                                            if (skRes && skRes.ret === 0) {
                                                useSkillTimes++;
                                                if (skRes.boardInfo) curBoard = skRes.boardInfo;
                                                chess = curBoard.chess || [];
                                            }
                                        } catch(eSk) {}
                                    }
                                }

                                // 2. Lập bản đồ lưới 11 hàng (y=0..10) x 9 cột (x=0..8)
                                let curGrid = Array(11).fill(null).map(() => Array(9).fill(0));
                                for (let c of chess) {
                                    let sz = c.len || 1;
                                    for (let dx = 0; dx < sz; dx++) {
                                        if (c.y < 11 && (c.x + dx) < 9) {
                                            curGrid[c.y][c.x + dx] = c.uid;
                                        }
                                    }
                                }

                                // 3. Tìm các nước đi hợp lệ & chấm điểm Heuristic
                                let candidateMoves = [];
                                for (let p of chess) {
                                    let sz = p.len || 1;
                                    let py = p.y;
                                    let px = p.x;

                                    let validTargetXs = [];
                                    for (let tx = px - 1; tx >= 0; tx--) {
                                        if (curGrid[py][tx] === 0) validTargetXs.push(tx);
                                        else break;
                                    }
                                    for (let tx = px + 1; tx <= 9 - sz; tx++) {
                                        if (curGrid[py][tx + sz - 1] === 0) validTargetXs.push(tx);
                                        else break;
                                    }

                                    for (let tx of validTargetXs) {
                                        let isReverseMove = false;
                                        if (moveHistory.length > 0) {
                                            for (let hm of moveHistory.slice(-3)) {
                                                if (hm.uid === p.uid && hm.fromX === tx) {
                                                    isReverseMove = true;
                                                    break;
                                                }
                                            }
                                        }

                                        let simRes = simulateMove(chess, p.uid, tx);

                                        let moveScore = 0;
                                        if (simRes.linesCleared > 0) {
                                            moveScore += simRes.linesCleared * 10000000;
                                            if (simRes.linesCleared >= 2) moveScore += simRes.linesCleared * 5000000;
                                            moveScore += (11 - simRes.maxH) * 1000000;
                                        } else {
                                            let bestRowCount = Math.max(...simRes.rowCounts);
                                            if (bestRowCount === 8) moveScore += 900000;
                                            else if (bestRowCount === 7) moveScore += 350000;
                                            else if (bestRowCount === 6) moveScore += 100000;

                                            if (simRes.maxH >= 9) moveScore -= (simRes.maxH - 7) * 2000000;
                                            else if (simRes.maxH >= 8) moveScore -= 600000;
                                            else moveScore -= simRes.maxH * 10000;

                                            moveScore -= simRes.holes * 20000;
                                            if (py >= 7) moveScore += 150000;
                                        }

                                        if (isReverseMove) moveScore -= 3000000;

                                        candidateMoves.push({
                                            uid: p.uid,
                                            fromX: px,
                                            toX: tx,
                                            sim: simRes,
                                            score: moveScore
                                        });
                                    }
                                }

                                if (candidateMoves.length === 0) break;

                                candidateMoves.sort((a, b) => b.score - a.score);
                                let best = candidateMoves[0];

                                let mRes = await amNet.reqMoceChess(actId, best.uid, best.toX, false, false);
                                if (!mRes || mRes.ret !== 0) break;

                                totalMoves++;
                                moveHistory.push({ uid: best.uid, fromX: best.fromX, toX: best.toX });
                                if (moveHistory.length > 8) moveHistory.shift();

                                // Kết thúc vòng để nhận hàng động vật mới
                                let erRes = await amMgr.reqEndRound(actId, false);
                                if (erRes && erRes.ret === 0) {
                                    curBoard = erRes.boardInfo;
                                    if (curBoard && curBoard.score && curBoard.score > maxScoreAchieved) {
                                        maxScoreAchieved = curBoard.score;
                                    }
                                    let mData = amMgr.model ? amMgr.model.getAnimalMigrationData(actId) : null;
                                    let endMsg = mData ? mData.getGameEndMsg(actId) : null;
                                    if (endMsg) {
                                        isGameOver = true;
                                        break;
                                    }
                                } else {
                                    break;
                                }
                            }

                            // BẮT BUỘC BẤM [HỦY] (KHÔNG HỒI SINH 200 KIM CƯƠNG) ĐỂ KẾT THÚC VÁN & NHẬN THƯỞNG
                            try {
                                if (amNet) await amNet.reqResult(actId, false, false);
                                if (amMgr && amMgr.model) {
                                    let mData = amMgr.model.getAnimalMigrationData(actId);
                                    if (mData) mData.clearGameEndMsg(actId);
                                }
                            } catch(e) {}

                            // Đóng các popup kết thúc/thưởng nếu có hiển thị trên màn hình
                            if (uiMgr && rView) {
                                try { if (uiMgr.isViewOpen(rView)) uiMgr.close(rView); } catch(e){}
                            }
                            if (amMgr) await amMgr.reqInfo(actId);
                        }

                        g.__am_result = {
                            ok: true,
                            gamesPlayed: gamesPlayed,
                            maxScore: maxScoreAchieved,
                            totalMoves: totalMoves,
                            illustratedClaimed: illustratedClaimed,
                            levelUpCount: levelUpCount,
                            freeShopClaimed: freeShopClaimed,
                            stopped: Boolean((typeof window !== 'undefined' && window.__stop_requested) || (typeof globalThis !== 'undefined' && globalThis.__stop_requested))
                        };
                    } catch(e) {
                        g.__am_result = {ok: false, error: e.toString()};
                    }
                })();
                return JSON.stringify({started: true});
            })();
}};
P.workers["khoanh_khac_am_ap"]={definition:{"id": "khoanh_khac_am_ap", "name": "Khoảnh khắc ấm áp", "types": [22], "action": "action_khoanh_khac_am_ap", "var": "js_run", "result": "__warm_exec", "counters": ["claimedTasks", "noodlesUsed", "claimedMilestones"]},launch:function(scope,params){var window=scope.window,globalThis=window,__require=scope.require,setTimeout=window.setTimeout,clearTimeout=window.clearTimeout,setInterval=window.setInterval,clearInterval=window.clearInterval;
return (function() {
                        let g = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : this);
                        let req = g.__require;
                        if (!req) return JSON.stringify({err: "no_require"});
                        
                        let actId = params.activityId;
                        let net = req('SkinRebateNetUtil') && req('SkinRebateNetUtil').skinRebateNetUtil;
                        let util = req('SkinRebateUtil') && req('SkinRebateUtil').skinRebateUtil;
                        let bnu = req('BagNetUtil') && (req('BagNetUtil').BagNetUtil || req('BagNetUtil'));
                        let anu = req('ActivityNetUtil') && (req('ActivityNetUtil').ActivityNetUtil || req('ActivityNetUtil'));
                        let BM = req('BagMgr') && (req('BagMgr').inst || req('BagMgr').BagMgr.inst);
                        let actMgr = req('ActivityMgr') && req('ActivityMgr').ActivityMgr.inst;

                        g.__warm_exec = {};
                        (async () => {
                            try {
                                // 1. Nhận toàn bộ quà nhiệm vụ SK
                                let taskRes = null;
                                if (net && net.getAllTaskReward) {
                                    taskRes = await net.getAllTaskReward(actId);
                                }
                                
                                // 2. Lấy ID vật phẩm tiêu hao ("Đưa mì" - 121050)
                                let costItemId = 121050;
                                let actObj = actMgr && actMgr.model && actMgr.model.activityDict && actMgr.model.activityDict[actId];
                                if (util && actObj && util.getCostItemId) {
                                    costItemId = util.getCostItemId(actObj) || 121050;
                                }
                                
                                // Đưa mì (Dùng toàn bộ mì trong túi)
                                let countBefore = BM ? Number(BM.getOwnCount(costItemId)) : 0;
                                let usedCount = 0;
                                if (countBefore > 0 && bnu && bnu.use) {
                                    let useRes = await bnu.use(costItemId, countBefore);
                                    if (useRes && (useRes.ret === 0 || useRes.ret === undefined)) {
                                        usedCount = countBefore;
                                    }
                                }
                                
                                // 3. "Bức ảnh" - Nhận toàn bộ mốc thành tựu (DataType 2 - Điểm Ấm Áp)
                                let claimAchieveIds = [];
                                if (actObj && actObj.getConditionTempListByDataType) {
                                    let achList = actObj.getConditionTempListByDataType(2) || [];
                                    for (let c of achList) {
                                        let cData = actObj.getConditionData(c.conditionId, true);
                                        let val = Number(cData.value || 0);
                                        let target = Number(c.paramList[3] || c.paramList[2] || 0);
                                        if (val >= target && !cData.isGetReward) {
                                            claimAchieveIds.push(c.conditionId);
                                        }
                                    }
                                }
                                
                                let achieveRes = null;
                                if (claimAchieveIds.length > 0 && anu && anu.getMultiReward) {
                                    achieveRes = await anu.getMultiReward(actId, claimAchieveIds);
                                }
                                
                                // Đóng các popup nhận quà và cập nhật view
                                try {
                                    let ui = req('UIMgr').UIMgr.inst;
                                    let dict = ui._viewDict || ui.viewDict || {};
                                    for (let k in dict) {
                                        let v = dict[k];
                                        if (v && v.cacheClassName && (v.cacheClassName.includes('Reward') || v.cacheClassName.includes('Alert') || v.cacheClassName.includes('Achieve'))) {
                                            try { v.closeSelf ? v.closeSelf() : ui.closeView(v); } catch(eC) {}
                                        }
                                        if (v && v.cacheClassName === 'SkinRebateTaskView' && v.initData && v.refreshView) {
                                            try { v.initData(); v.refreshView(); } catch(eR) {}
                                        }
                                    }
                                } catch(eClose) {}
                                
                                let currentPoints = 0;
                                if (util && actObj && util.getAchieveValue) {
                                    currentPoints = util.getAchieveValue(actObj);
                                }

                                g.__warm_exec = {
                                    ok: true,
                                    claimedTasks: (taskRes && taskRes.finishConditionIds) ? taskRes.finishConditionIds.length : 0,
                                    noodlesUsed: usedCount,
                                    claimedMilestones: claimAchieveIds.length,
                                    warmthPoints: currentPoints
                                };
                            } catch(e) {
                                g.__warm_exec = {ok: false, err: String(e)};
                            }
                        })();
                        return "started";
                    })();
}};
})(typeof window!=="undefined"?window:globalThis);
