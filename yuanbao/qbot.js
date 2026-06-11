/*********************************************
 元宝派 Bot 抢购脚本（统一版）
 功能：自动获取 Cookie + 有效性检查 + 并发抢购免费 Bot（仅晚8点）
 版本：1.0.0
 作者：JK-GL
 支持：Loon
 更新：2026-06-11

 【Loon 配置 - 一键导入方法】
 1. 添加脚本订阅：
    配置 → 脚本 → 订阅脚本 → 添加 URL：
    https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js
 2. 脚本会自动生成以下任务和复写，无需手动添加。

 【手动配置（如果不想用订阅）】
 [MITM]
 hostname = yuanbao.tencent.com

 [Script]
 # 定时任务（晚8点场）
 cron "55 19 * * *" script-path=https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js, tag=元宝派-晚8点场
 # 自动更新 Cookie（匹配所有 api 请求）
 http-request ^https:\/\/yuanbao\.tencent\.com\/api\/.* script-path=https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js, tag=元宝派-自动更新Cookie

 【使用步骤】
 1. 确保 Loon 的 MitM 已开启，并安装信任证书。
 2. 在 Safari 中登录 https://yuanbao.tencent.com/e/claw/manage，脚本会自动捕获 Cookie。
 3. 手动运行一次脚本（定时任务模式）以验证 Cookie 是否有效。
 4. 每天 19:55 会自动启动抢购流程。

 注意：本脚本同时支持重写（捕获 Cookie）和定时任务（抢购）。
*********************************************/

// ========== 配置参数 ==========
const ADVANCE_SECONDS = 20;       // 提前20秒开始抢
const MAX_RETRY_SECONDS = 120;    // 整点后抢120秒
const THREAD_COUNT = 20;          // 并发数
const REQUEST_INTERVAL_MS = 50;   // 请求间隔（毫秒）

// ========== 全局变量 ==========
let successFlag = false;
let totalRequests = 0;
let stopFlag = false;

// ========== 工具函数 ==========
function postRequest(url, headers, body) {
    return new Promise((resolve) => {
        $httpClient.post({
            url: url,
            headers: headers,
            body: JSON.stringify(body),
            timeout: 8
        }, (error, response, data) => {
            if (error) resolve({ error: error, status: null, data: null });
            else resolve({ error: null, status: response.status, data: data });
        });
    });
}

function getRequest(url, headers) {
    return new Promise((resolve) => {
        $httpClient.get({
            url: url,
            headers: headers,
            timeout: 8
        }, (error, response, data) => {
            if (error) resolve({ error: error, status: null, data: null });
            else resolve({ error: null, status: response.status, data: data });
        });
    });
}

function notify(title, content) {
    $notification.post(title, "", content);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== Cookie 管理 ==========
function getSavedCookie() {
    return $persistentStore.read("yuanbao_cookie");
}

function saveCookie(cookie) {
    $persistentStore.write(cookie, "yuanbao_cookie");
}

// ========== Cookie 有效性检查 ==========
async function verifyCookie(cookie) {
    if (!cookie) return false;
    const headers = {
        "Host": "yuanbao.tencent.com",
        "Origin": "https://yuanbao.tencent.com",
        "Referer": "https://yuanbao.tencent.com/e/claw/manage",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4_1 like Mac OS X) AppleWebKit/605.1.15",
        "Content-Type": "application/json",
        "Cookie": cookie
    };
    const url = "https://yuanbao.tencent.com/api/v5/accountLogic/userInfo";
    const resp = await getRequest(url, headers);
    if (resp.error || resp.status !== 200) return false;
    try {
        const data = JSON.parse(resp.data);
        if (data.code === 0 && data.data && data.data.userId) {
            console.log("✅ Cookie 有效，用户ID: " + data.data.userId);
            return true;
        }
    } catch (e) {}
    return false;
}

// ========== 抢购核心（单协程） ==========
async function grabWorker() {
    const url = "https://yuanbao.tencent.com/api/v5/robotLogic/create";
    const cookie = getSavedCookie();
    if (!cookie) return false;
    const headers = {
        "Host": "yuanbao.tencent.com",
        "Origin": "https://yuanbao.tencent.com",
        "Referer": "https://yuanbao.tencent.com/e/claw/manage",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4_1 like Mac OS X) AppleWebKit/605.1.15",
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Cookie": cookie
    };
    const payload = { type: 1, create_type: 1 };
    while (!stopFlag && !successFlag) {
        totalRequests++;
        const currentCount = totalRequests;
        const start = Date.now();
        const resp = await postRequest(url, headers, payload);
        const cost = Date.now() - start;
        if (resp.error) {
            console.log(`[${new Date().toLocaleTimeString()}] 第${currentCount}次 | 异常`);
        } else if (resp.status === 200) {
            try {
                const data = JSON.parse(resp.data);
                if (data.code === 0) {
                    successFlag = true;
                    console.log(`\n✅ 抢购成功！耗时:${cost}ms | 总请求:${currentCount}`);
                    return true;
                } else {
                    console.log(`[${new Date().toLocaleTimeString()}] 第${currentCount}次 | code=${data.code}`);
                }
            } catch (e) {}
        } else {
            console.log(`[${new Date().toLocaleTimeString()}] 第${currentCount}次 | HTTP ${resp.status}`);
        }
        await sleep(REQUEST_INTERVAL_MS);
    }
    return false;
}

// ========== 主抢购流程（仅晚8点） ==========
async function startGrabbing() {
    const cookie = getSavedCookie();
    if (!cookie) {
        console.log("❌ 未找到 Cookie，请先登录元宝派触发重写规则");
        notify("元宝派抢购失败", "未找到 Cookie，请先登录网页版");
        return false;
    }
    console.log("🔍 验证 Cookie...");
    const isValid = await verifyCookie(cookie);
    if (!isValid) {
        console.log("❌ Cookie 无效");
        notify("元宝派抢购失败", "Cookie 无效，请重新登录");
        return false;
    }
    console.log("✅ Cookie 有效，准备抢购 20:00 场次");
    const now = new Date();
    const targetHour = 20, targetMin = 0;
    let targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMin, 0);
    let targetTs = targetDate.getTime() / 1000;
    let startTs = targetTs - ADVANCE_SECONDS;
    let endTs = targetTs + MAX_RETRY_SECONDS;
    let currentTs = now.getTime() / 1000;
    if (currentTs > endTs) {
        console.log("⚠️ 已过抢购时间");
        return false;
    }
    if (currentTs < startTs) {
        let waitSec = startTs - currentTs;
        console.log(`⏰ 等待 ${waitSec.toFixed(0)} 秒...`);
        await sleep(waitSec * 1000);
    }
    console.log(`\n🚀 并发抢购启动，并发数：${THREAD_COUNT}`);
    successFlag = false;
    stopFlag = false;
    totalRequests = 0;
    const timeoutId = setTimeout(() => {
        stopFlag = true;
        console.log(`\n⏰ 未抢到，总请求 ${totalRequests}`);
        notify("元宝派抢购", `未抢到名额，总请求 ${totalRequests}`);
    }, MAX_RETRY_SECONDS * 1000);
    const workers = [];
    for (let i = 0; i < THREAD_COUNT; i++) workers.push(grabWorker());
    await Promise.race(workers);
    if (successFlag) {
        clearTimeout(timeoutId);
        notify("元宝派抢购成功", `✅ 成功！总请求 ${totalRequests}`);
    } else {
        await Promise.allSettled(workers);
    }
    return successFlag;
}

// ========== 脚本入口：根据运行环境自动选择模式 ==========
if (typeof $request !== 'undefined') {
    // 重写模式：捕获 Cookie
    let cookie = $request.headers["Cookie"] || $request.headers["cookie"];
    if (cookie && cookie.includes("hy_token") && cookie.includes("hy_user")) {
        saveCookie(cookie);
        console.log("✅ 已保存元宝派 Cookie");
        notify("元宝派", "Cookie 已自动更新");
    } else if (cookie) {
        console.log("⚠️ 捕获到 Cookie 但缺少必要字段，可能未登录");
    } else {
        console.log("ℹ️ 未提取到 Cookie");
    }
    $done({});
} else {
    // 定时任务模式：执行抢购
    startGrabbing().catch(err => {
        console.log(`❌ 错误: ${err}`);
        notify("元宝派错误", err.message);
    });
}
