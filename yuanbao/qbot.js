/*********************************************
 元宝派 Bot 抢购脚本（仅晚8点场）
 功能：自动获取 Cookie + 有效性检查 + 并发抢购免费 Bot
 版本：1.0.0
 作者：JK-GL
 支持：Loon / Surge / Quantumult X
 更新：2026-06-11

 【Loon 配置】
 [MITM]
 hostname = yuanbao.tencent.com

 [Script]
 # 定时任务（晚上 19:55 启动，抢 20:00）
 cron "55 19 * * *" script-path=https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js, tag=元宝派-晚8点场
 # 自动更新 Cookie
 http-request ^https:\/\/yuanbao\.tencent\.com\/api\/v5\/accountLogic\/.* script-path=https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js, tag=元宝派-自动更新Cookie

 【Surge 配置】
 [MITM]
 hostname = yuanbao.tencent.com

 [Script]
 元宝派-晚8点场 = type=cron,cronexp="55 19 * * *",script-path=https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js
 元宝派-自动更新Cookie = type=http-request,pattern=^https:\/\/yuanbao\.tencent\.com\/api\/v5\/accountLogic\/.*,script-path=https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js

 【Quantumult X 配置】
 [mitm]
 hostname = yuanbao.tencent.com

 [rewrite_local]
 ^https:\/\/yuanbao\.tencent\.com\/api\/v5\/accountLogic\/.* url script-request-header https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js

 [task_local]
 55 19 * * * https://raw.githubusercontent.com/JK-GL/wulawulai/main/yuanbao/qbot.js, tag=元宝派-晚8点场

 【使用步骤】
 1. 根据你的代理软件，复制上方对应的配置到相应位置。
 2. 开启 MITM，安装并信任证书。
 3. 在浏览器中访问 https://yuanbao.tencent.com 并登录，脚本会自动捕获 Cookie。
 4. 手动运行一次脚本（在软件脚本列表里点“运行”），查看日志确认 Cookie 有效。
 5. 定时任务会自动在每天 19:55 启动，提前 20 秒开始并发抢购 20:00 场次。

 注意：本脚本只抢晚上 20:00 场次，不会触发其他时间。
*********************************************/

// ================== 配置参数（可按需修改）==================
const ADVANCE_SECONDS = 20;       // 提前多少秒开始抢（默认 20 秒）
const MAX_RETRY_SECONDS = 120;    // 整点后最多抢多少秒（默认 120 秒）
const THREAD_COUNT = 20;          // 并发请求数（建议 10~30）
const REQUEST_INTERVAL_MS = 50;   // 每个协程内请求间隔（毫秒）

// ================== 全局变量 ==================
let successFlag = false;
let totalRequests = 0;
let stopFlag = false;

// ================== 工具函数 ==================
function postRequest(url, headers, body) {
    return new Promise((resolve) => {
        $httpClient.post({
            url: url,
            headers: headers,
            body: JSON.stringify(body),
            timeout: 8
        }, (error, response, data) => {
            if (error) {
                resolve({ error: error, status: null, data: null });
            } else {
                resolve({ error: null, status: response.status, data: data });
            }
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
            if (error) {
                resolve({ error: error, status: null, data: null });
            } else {
                resolve({ error: null, status: response.status, data: data });
            }
        });
    });
}

function notify(title, content) {
    $notification.post(title, "", content);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ================== Cookie 管理 ==================
function getSavedCookie() {
    return $persistentStore.read("yuanbao_cookie");
}

function saveCookie(cookie) {
    $persistentStore.write(cookie, "yuanbao_cookie");
}

// ================== Cookie 有效性检查 ==================
async function verifyCookie(cookie) {
    if (!cookie) return false;
    
    const headers = {
        "Host": "yuanbao.tencent.com",
        "Origin": "https://yuanbao.tencent.com",
        "Referer": "https://yuanbao.tencent.com/e/claw/manage",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
        "Cookie": cookie
    };
    
    const url = "https://yuanbao.tencent.com/api/v5/accountLogic/userInfo";
    const resp = await getRequest(url, headers);
    
    if (resp.error || resp.status !== 200) {
        console.log("❌ Cookie 验证请求失败: " + (resp.error || `HTTP ${resp.status}`));
        return false;
    }
    
    try {
        const data = JSON.parse(resp.data);
        if (data.code === 0 && data.data && data.data.userId) {
            console.log("✅ Cookie 有效，用户ID: " + data.data.userId);
            return true;
        } else {
            console.log("❌ Cookie 无效，接口返回 code: " + data.code);
            return false;
        }
    } catch (e) {
        console.log("❌ Cookie 验证响应解析失败");
        return false;
    }
}

// ================== 抢购核心逻辑（单个协程） ==================
async function grabWorker() {
    const url = "https://yuanbao.tencent.com/api/v5/robotLogic/create";
    const cookie = getSavedCookie();
    if (!cookie) return false;

    const headers = {
        "Host": "yuanbao.tencent.com",
        "Origin": "https://yuanbao.tencent.com",
        "Referer": "https://yuanbao.tencent.com/e/claw/manage",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
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
            console.log(`[${new Date().toLocaleTimeString()}] 第${currentCount}次 | 异常: ${resp.error}`);
        } else if (resp.status === 200) {
            try {
                const data = JSON.parse(resp.data);
                if (data.code === 0) {
                    successFlag = true;
                    console.log(`\n✅ 抢 Bot 成功！耗时:${cost}ms | 总请求:${currentCount}`);
                    return true;
                } else {
                    console.log(`[${new Date().toLocaleTimeString()}] 第${currentCount}次 | code=${data.code}`);
                }
            } catch (e) {
                console.log(`[${new Date().toLocaleTimeString()}] 第${currentCount}次 | JSON解析失败`);
            }
        } else {
            console.log(`[${new Date().toLocaleTimeString()}] 第${currentCount}次 | HTTP ${resp.status}`);
        }

        await sleep(REQUEST_INTERVAL_MS);
    }
    return false;
}

// ================== 主抢购流程（固定晚8点） ==================
async function startGrabbing() {
    const cookie = getSavedCookie();
    if (!cookie) {
        console.log("❌ 未找到 Cookie，请先触发重写规则登录一次元宝派");
        notify("元宝派抢购失败", "未找到 Cookie，请登录网页版并确保重写规则生效");
        return false;
    }

    console.log("🔍 正在验证 Cookie 有效性...");
    const isValid = await verifyCookie(cookie);
    if (!isValid) {
        console.log("❌ Cookie 无效或已过期，请重新登录");
        notify("元宝派抢购失败", "Cookie 无效或已过期，请重新登录网页版");
        return false;
    }
    console.log("✅ Cookie 有效，继续抢购流程");

    // 固定目标为晚上 20:00:00
    const now = new Date();
    const targetHour = 20;
    const targetMin = 0;
    const targetDesc = "20:00";

    // 计算今天的目标时间戳
    let targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMin, 0);
    let targetTs = targetDate.getTime() / 1000;
    let startTs = targetTs - ADVANCE_SECONDS;
    let endTs = targetTs + MAX_RETRY_SECONDS;
    let currentTs = now.getTime() / 1000;

    // 如果当前时间已经超过结束时间，则提示并退出
    if (currentTs > endTs) {
        console.log("⚠️ 当前时间已过抢购时段（20:00），请确保定时任务设置在 19:55 执行");
        notify("元宝派提醒", "当前时间已过20:00抢购时段，请检查定时任务");
        return false;
    }

    // 如果还没到开始时间，则等待
    if (currentTs < startTs) {
        let waitSec = startTs - currentTs;
        console.log(`⏰ 距离20:00抢购还有 ${Math.round(waitSec)} 秒，等待中...`);
        await sleep(waitSec * 1000);
    }

    console.log(`\n🚀 多协程并发抢购启动！并发数：${THREAD_COUNT}`);
    console.log(`   目标场次：${targetDesc}`);
    console.log("-".repeat(60));

    successFlag = false;
    stopFlag = false;
    totalRequests = 0;

    const timeoutId = setTimeout(() => {
        stopFlag = true;
        console.log(`\n⏰ 抢购时间结束，未抢到名额，总请求：${totalRequests}`);
        notify("元宝派抢购", `未抢到名额，总请求次数：${totalRequests}`);
    }, MAX_RETRY_SECONDS * 1000);

    const workers = [];
    for (let i = 0; i < THREAD_COUNT; i++) {
        workers.push(grabWorker());
    }
    await Promise.race(workers);

    if (successFlag) {
        clearTimeout(timeoutId);
        const title = "元宝派 Bot 抢购成功";
        const content = `✅ 抢购成功！\n场次：${targetDesc}\n总请求：${totalRequests}\n并发数：${THREAD_COUNT}`;
        notify(title, content);
    } else {
        await Promise.allSettled(workers);
    }
    return successFlag;
}

// ================== 脚本入口 ==================
if (typeof $request !== 'undefined') {
    // 重写模式：捕获并更新 Cookie
    let cookie = $request.headers["Cookie"] || $request.headers["cookie"];
    if (cookie) {
        let url = $request.url;
        if (url.includes("/api/v5/accountLogic/") || url.includes("/api/v5/robotLogic/")) {
            saveCookie(cookie);
            console.log("✅ 已自动保存 Cookie 到存储");
            notify("元宝派", "Cookie 已自动更新，抢购脚本可用");
        } else {
            console.log("⏭ 非关键接口，未保存 Cookie");
        }
    } else {
        console.log("⚠️ 未从请求中提取到 Cookie");
    }
    $done({});
} else {
    // 定时任务模式：执行抢购（仅限晚8点场）
    startGrabbing().catch(err => {
        console.log(`❌ 抢购执行出错: ${err}`);
        notify("元宝派错误", err.message);
    });
}
