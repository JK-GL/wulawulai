/*********************************************
 元宝派 Bot 抢购脚本（统一版）
 功能：自动获取 Cookie（监听管理页）+ 有效性检查 + 并发抢购（仅晚8点）
 版本：1.2.0
 作者：JK-GL
 支持：Loon
 更新：2026-06-11

 【Loon 配置】
 [MITM]
 hostname = yuanbao.tencent.com

 [Script]
 # 定时任务（晚8点场）
 cron "55 19 * * *" script-path=https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js, tag=元宝派-晚8点场

 # 自动获取 Cookie（监听管理页面）
 http-request ^https:\/\/yuanbao\.tencent\.com\/e\/claw\/manage script-path=https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js, tag=元宝派-自动更新Cookie

 【使用步骤】
 1. 开启 MitM，添加 hostname: yuanbao.tencent.com，安装并信任证书。
 2. 添加上述两条 Script 规则（一条 cron，一条 http-request）。
 3. 在 Safari 中打开 https://yuanbao.tencent.com/e/claw/manage 并登录。
 4. 脚本会自动捕获 Cookie 并存储。
 5. 每天 19:55 自动抢购 20:00 场次。
*********************************************/

// ========== 配置参数 ==========
const ADVANCE_SECONDS = 20;
const MAX_RETRY_SECONDS = 120;
const THREAD_COUNT = 20;
const REQUEST_INTERVAL_MS = 50;

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

// ========== Cookie 有效性检查（改用 /api/getuserinfo） ==========
async function verifyCookie(cookie) {
    if (!cookie) return false;
    
    // 确保 cookie 是字符串（如果是数组则用分号+空格拼接）
    let cookieStr = cookie;
    if (Array.isArray(cookie)) {
        cookieStr = cookie.join('; ');
    }
    
    const headers = {
        "Host": "yuanbao.tencent.com",
        "Origin": "https://yuanbao.tencent.com",
        "Referer": "https://yuanbao.tencent.com/e/claw/manage",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4_1 like Mac OS X) AppleWebKit/605.1.15",
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        "x-language": "zh-CN",
        "Cookie": cookieStr
    };
    
    const url = "https://yuanbao.tencent.com/api/getuserinfo";
    const resp = await getRequest(url, headers);
    
    if (resp.error || resp.status !== 200) {
        console.log("❌ Cookie 验证请求失败: " + (resp.error || `HTTP ${resp.status}`));
        return false;
    }
    
    try {
        const data = JSON.parse(resp.data);
        // /api/getuserinfo 返回格式: {"code":0,"data":{"userId":"xxx",...}}
        if (data.code === 0 && data.data && data.data.userId) {
            console.log("✅ Cookie 有效，用户ID: " + data.data.userId);
            return true;
        } else {
            console.log("❌ Cookie 无效，接口返回: " + JSON.stringify(data));
            return false;
        }
    } catch (e) {
        console.log("❌ Cookie 验证响应解析失败: " + e.message);
        return false;
    }
}

// ========== 抢购核心（单协程） ==========
async function grabWorker() {
    const url = "https://yuanbao.tencent.com/api/v5/robotLogic/create";
    const cookie = getSavedCookie();
    if (!cookie) return false;
    
    // 同样处理 cookie 字符串格式
    let cookieStr = cookie;
    if (Array.isArray(cookie)) cookieStr = cookie.join('; ');
    
    const headers = {
        "Host": "yuanbao.tencent.com",
        "Origin": "https://yuanbao.tencent.com",
        "Referer": "https://yuanbao.tencent.com/e/claw/manage",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_4_1 like Mac OS X) AppleWebKit/605.1.15",
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "Cookie": cookieStr
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
        console.log("❌ 未找到 Cookie，请先访问管理页面触发重写");
        notify("元宝派抢购失败", "未找到 Cookie，请先登录管理页面");
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

// ========== 脚本入口 ==========
if (typeof $request !== 'undefined') {
    // 重写模式：捕获 Cookie（监听管理页面）
    let cookie = $request.headers["Cookie"] || $request.headers["cookie"];
    if (cookie) {
        // 处理数组格式
        let cookieStr = Array.isArray(cookie) ? cookie.join('; ') : cookie;
        let url = $request.url || "";
        if (url.includes("/e/claw/manage") || url.includes("/api/")) {
            if (cookieStr.includes("hy_token") && cookieStr.includes("hy_user")) {
                saveCookie(cookieStr);
                console.log("✅ 已保存元宝派 Cookie (来自 " + url + ")");
                notify("元宝派", "Cookie 已自动更新");
            } else {
                console.log("⚠️ Cookie 缺少必要字段，可能未登录");
            }
        } else {
            console.log("ℹ️ 未匹配到关键路径，不保存 Cookie");
        }
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
