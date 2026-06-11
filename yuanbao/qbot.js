/*********************************************
 元宝派 Bot 抢购脚本（调试版）
 功能：自动获取 Cookie + 详细日志输出，用于排查验证失败原因
*********************************************/

// ========== 配置参数 ==========
const ADVANCE_SECONDS = 20;
const MAX_RETRY_SECONDS = 120;
const THREAD_COUNT = 20;
const REQUEST_INTERVAL_MS = 50;

let successFlag = false;
let totalRequests = 0;
let stopFlag = false;

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

function getSavedCookie() {
    return $persistentStore.read("yuanbao_cookie");
}

function saveCookie(cookie) {
    $persistentStore.write(cookie, "yuanbao_cookie");
}

// ========== 详细验证 Cookie（打印返回内容） ==========
async function verifyCookie(cookie) {
    if (!cookie) return false;
    
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
    console.log("🔍 正在请求验证接口: " + url);
    const resp = await getRequest(url, headers);
    
    console.log("📡 响应状态: " + resp.status);
    if (resp.error) {
        console.log("❌ 错误信息: " + resp.error);
        return false;
    }
    
    console.log("📄 原始返回数据: " + (resp.data || "空"));
    
    if (resp.status !== 200) {
        console.log("❌ HTTP 状态码非 200");
        return false;
    }
    
    try {
        const data = JSON.parse(resp.data);
        console.log("📊 解析后的 JSON: " + JSON.stringify(data, null, 2));
        if (data.code === 0 && data.data && data.data.userId) {
            console.log("✅ Cookie 有效，用户ID: " + data.data.userId);
            return true;
        } else {
            console.log("❌ 验证失败: code=" + data.code + ", 结构不符合预期");
            return false;
        }
    } catch (e) {
        console.log("❌ JSON 解析异常: " + e.message);
        return false;
    }
}

// ========== 抢购核心（单协程） ==========
async function grabWorker() {
    const url = "https://yuanbao.tencent.com/api/v5/robotLogic/create";
    const cookie = getSavedCookie();
    if (!cookie) return false;
    
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

// ========== 主抢购流程 ==========
async function startGrabbing() {
    const cookie = getSavedCookie();
    if (!cookie) {
        console.log("❌ 未找到 Cookie");
        notify("元宝派抢购失败", "未找到 Cookie");
        return false;
    }
    console.log("📦 当前存储的 Cookie 字符串: " + cookie.substring(0, 100) + "...");
    const isValid = await verifyCookie(cookie);
    if (!isValid) {
        console.log("❌ Cookie 无效");
        notify("元宝派抢购失败", "Cookie 无效，请查看详细日志");
        return false;
    }
    // 以下抢购逻辑省略（与之前相同），先解决验证问题
    console.log("✅ Cookie 有效，继续抢购流程...");
    // 这里可以继续写抢购逻辑，但为了调试，先只验证
    return true;
}

// ========== 脚本入口 ==========
if (typeof $request !== 'undefined') {
    // 重写模式：捕获 Cookie
    let cookie = $request.headers["Cookie"] || $request.headers["cookie"];
    if (cookie) {
        let cookieStr = Array.isArray(cookie) ? cookie.join('; ') : cookie;
        let url = $request.url || "";
        if (url.includes("/e/claw/manage") || url.includes("/api/")) {
            if (cookieStr.includes("hy_token") && cookieStr.includes("hy_user")) {
                saveCookie(cookieStr);
                console.log("✅ 已保存 Cookie");
                notify("元宝派", "Cookie 已更新");
            } else {
                console.log("⚠️ Cookie 缺少 hy_token/hy_user");
            }
        }
    }
    $done({});
} else {
    startGrabbing().catch(err => {
        console.log(`❌ 错误: ${err}`);
        notify("元宝派错误", err.message);
    });
}
