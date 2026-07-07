# **ESP32 芯片全家族系统级产品手册与工程应用指南**

## **1\. 产品版本划分与硬件演进体系**

自乐鑫信息科技（Espressif Systems）于 2016 年发布首款双核物联网芯片以来，ESP32 已经从单一的产品型号演变为一个庞大的多核、跨架构半导体芯片家族1。该家族共享统一的 ESP-IDF 软件开发框架，但在处理器架构（Xtensa 与 RISC-V）、无线协议组合、物理尺寸及外设资源等方面进行了精细化的市场细分，以满足从极低成本传感器节点到复杂边缘计算多媒体人机交互接口（HMI）的多样化需求2。

### **1.1 核心芯片系列分类**

ESP32 家族目前主要由以下五个核心产品线组成，每个系列在无线和计算资源上各有其独特的市场定位：

* **ESP32 经典系列（The Classic）**：作为初代成熟平台，采用双核 Xtensa LX6 处理器1。其最独特的特征是同时支持 Wi-Fi 4 和蓝牙双模（经典蓝牙 \+ 蓝牙低功耗 BLE 4.2）5。在需要兼容老旧经典蓝牙音频（如 A2DP、AVRCP 协议）或传统蓝牙设备的场景中，经典 ESP32 依然是不可替代的实用选择6。  
* **ESP32-S 高性能与多媒体系列（High-Performance & Multimedia）**：专注于边缘计算、HMI 交互与轻量级 AI 语音/图像识别6。其中，**ESP32-S2** 采用单核 Xtensa LX7 架构，移除了蓝牙，但引入了物理 USB-OTG 与高规格的数模转换器（DAC）支持，常用于安全通信终端或 USB 设备控制2；而 **ESP32-S3** 则是目前最主流的高性能型号，配备双核 Xtensa LX7，集成了 AI 向量指令集、大容量八线高速 PSRAM 及摄像头/LCD 硬件接口4。此外，新推出的 **ESP32-S31** 系列采用了双核 32 位 RISC-V 处理器，运行频率达到 320 MHz，支持内存管理单元（MMU）和单指令多数据（SIMD）加速，配备 250 MHz 8位 DDR PSRAM，进一步推高了多媒体处理能力的上限9。  
* **ESP32-C 开放式 RISC-V 经济系列（Cost-Effective RISC-V）**：标志着乐鑫全面拥抱开源 RISC-V 指令集架构3。该系列致力于以极高的性价比和更低的能耗替换传统的 8位/16位 单片机及上一代 ESP82664。代表型号包括极简的 **ESP32-C2**（又称 ESP8684）1、高性价比的主流 **ESP32-C3**11，以及支持 Wi-Fi 6、蓝牙 5.3 和 Matter/Thread/Zigbee 多协议的智慧家庭核心 **ESP32-C6**2。此外，支持 2.4/5 GHz 双频 Wi-Fi 6 的 **ESP32-C5** 以及搭载 BLE 6.0 的 **ESP32-C61** 为高密度网络连接提供了面向未来的技术底座1。  
* **ESP32-H 低功耗多协议 Mesh 系列（Wireless Mesh / Thread / Zigbee）**：专为智能家居 Mesh 网络设计的无 Wi-Fi 方案3。以 **ESP32-H2** 为代表，该系列仅集成 802.15.4（支持 Thread 与 Zigbee 协议）及低功耗蓝牙，消除了 Wi-Fi 的射频高功耗负担，能够以极低的能耗作为 Matter 协议生态下的边缘传感器节点运行2。后续推出的 **ESP32-H4** 升级为双核 96 MHz RISC-V 架构，并引入了蓝牙 5.4、低功耗音频（LE Audio）及寻向功能（Direction Finding），显著提升了定位精度与音频质量2。  
* **ESP32-P 高性能多媒体旗舰系列（Wireless-Free Flagship）**：该系列不带板载无线射频，转而将全部硅片面积投入到超高频计算与硬件编解码上2。例如 **ESP32-P4** 配备了主频高达 400 MHz 的双核 RISC-V 处理器、硬件 H.264 视频编码器、MIPI-CSI/DSI 图像接口，专为高级智能 HMI 交互、1080P 多媒体网关及复杂的边缘机器视觉量身定制1。通常需要通过 SPI/SDIO 级联其他无线协同处理器（如 ESP32-C6）来实现物联网接入6。

### **1.2 模组命名规则与封装体系**

在实际采购与硬件工程设计中，理解乐鑫及其授权合作伙伴（如安信可 AI-Thinker）的模组命名规则至关重要2。模组通常以以下三种核心物理形态呈现2：

* **MINI**：采用极为紧凑的尺寸设计，引脚间距较小，通常仅支持较小容量的集成 Flash（如 4 MB 或 8 MB），适合对物理空间要求极苛刻的微型穿戴设备或传感器节点2。  
* **WROOM**：目前应用最广泛的标准通用型模组，引脚易于焊接，能够承载更大容量的物理 Flash 和片外伪静态随机存储器（PSRAM）2。在经典 ESP32 和 ESP32-S2 时代，WROOM 模组默认不包含 PSRAM2。但在 ESP32-S3 及后续代际中，WROOM 模组已全面支持配置不同容量的 Flash 与 PSRAM 组合，逐步淘汰了过往专指搭载 PSRAM 的 WROVER 命名体系2。  
* **WROVER**：属于早期经典 ESP32 及 ESP32-S2 时代的专用术语，专门用来标识内置了 8 MB 外置 PSRAM 的大容量大尺寸模组，当前在新方案设计中已不作为主流推荐2。

具体的器件订货编码中，各种字母与数字后缀代表着明确的硬件属性2：

* **Nx/Rx/Hx 系列后缀**：其中 Nx 字母代表 SPI Flash 的物理容量（例如 N4 代表 4 MB，N8 代表 8 MB，N16 代表 16 MB 闪存）2；Rx 代表板载集成的 PSRAM 容量（例如 R2 代表 2 MB，R8 代表 8 MB 八线高速 PSRAM）2；Hx 则代表该型号属于耐高温高物理可靠性固件版本2。  
* **天线物理接口后缀**：后缀中不带 U 的型号（如 ESP32-S3-WROOM-1）默认集成物理板载 PCB 蛇形微带天线13；而带有 U 后缀的型号（如 ESP32-S3-WROOM-1U）则不带 PCB 天线，转而集成一个超微型的 IPEX（U.FL）第一代射频同轴连接器座，用于物理外接高增益棒状天线，以适应金属屏蔽外壳或超长距离通信环境2。

### **1.3 ESP32 芯片全家族规格对比**

下表详细汇总了 ESP32 全系列主流芯片的核心硬件配置，以便于硬件系统架构师进行选型评估：

| 芯片型号 | CPU 架构与核心数 | 主频 (MHz) | SRAM (KB) | 内部 ROM (KB) | 闪存/PSRAM 支持最大值 | 射频协议矩阵 | 物理 GPIO | 典型深睡电流 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **ESP32** | Xtensa LX6 双核/单核1 | 2405 | 5205 | 4485 | 外置 16MB Flash / 4MB PSRAM1 | Wi-Fi 4, 经典蓝牙, BLE 4.25 | 345 | ![][image1] µA5 |
| **ESP32-S2** | Xtensa LX7 单核8 | 2408 | 3208 | 1288 | 外置 16MB Flash / 2MB PSRAM8 | Wi-Fi 4 (无蓝牙)2 | 438 | ![][image1] µA3 |
| **ESP32-S3** | Xtensa LX7 双核7 | 2407 | 5127 | 3849 | 八线 16MB Flash / 16MB PSRAM7 | Wi-Fi 4, BLE 5.04 | 457 | ![][image1] µA14 |
| **ESP32-S31** | RISC-V 双核9 | 3209 | 5129 | 3209 | 八线 32MB Flash / 32MB PSRAM9 | Wi-Fi 6, BLE 5.4, 802.15.49 | 609 | ![][image1] µA |
| **ESP32-C2** | RISC-V 单核1 | 1201 | 2721 | 1281 | 内置最大 4MB Flash (不支持 PSRAM)1 | Wi-Fi 4, BLE 5.04 | 141 | ![][image2] µA3 |
| **ESP32-C3** | RISC-V 单核1 | 1601 | 4001 | 3841 | 外置 16MB Flash (不支持 PSRAM)1 | Wi-Fi 4, BLE 5.03 | 221 | ![][image2] µA3 |
| **ESP32-C5** | RISC-V 单核1 | 2401 | 3841 | 3841 | 外置 16MB Flash / 8MB PSRAM1 | 双频 Wi-Fi 6, BLE 5.23 | 301 | ![][image1] µA15 |
| **ESP32-C6** | RISC-V 单核1 | 1601 | 5121 | 3201 | 外置 16MB Flash (不支持 PSRAM)1 | Wi-Fi 6, BLE 5.3, Thread, Zigbee3 | 301 | ![][image2] µA15 |
| **ESP32-C61** | RISC-V 单核1 | 160 | 3201 | 2561 | 外置 16MB Flash / 8MB PSRAM1 | Wi-Fi 6, BLE 6.01 | 301 | ![][image1] µA15 |
| **ESP32-H2** | RISC-V 单核1 | 961 | 2561 | 1281 | 外置 8MB Flash (不支持 PSRAM)1 | BLE 5.3, Thread, Zigbee (无 Wi-Fi)1 | 261 | ![][image3] µA16 |
| **ESP32-H4** | RISC-V 双核2 | 962 | 256 | 128 | 外置 16MB Flash (不支持 PSRAM) | BLE 5.4, LE Audio, Zigbee, Thread | 30 | ![][image3] µA |
| **ESP32-P4** | RISC-V 双核1 | 4001 | 7681 | 5121 | 外置 16MB Flash / 16MB PSRAM1 | 无板载无线射频 (集成以太网 MAC)1 | 501 | 仅数字待机17 |

## **2\. 硬件系统设计与 PCB 布局规范**

在物联网硬件工程化落地过程中，由于 ESP32 芯片的射频发射瞬时功耗极高且对时钟抖动极为敏感，硬件原理图及 PCB 布局设计的质量直接决定了系统的抗干扰能力、无线电磁兼容（EMC）表现与无线通信距离18。

### **2.1 供电网路设计与去耦电容配置**

ESP32 芯片内部集成了高频数字电路、敏感的模拟前端以及大功率的无线射频放大器（PA）5。在 Wi-Fi 搜网和连接的突发阶段，PA 会在微秒级时间内抽头高达 ![][image4]（甚至峰值超过 ![][image5]）的瞬态脉冲电流14。如果供电网络（PDN）阻抗不合格，将直接导致电轨塌陷，触发内部褐出复位硬件中断21。

#### **2.1.1 稳压源选型基准**

供电稳压器（通常为低压差线性稳压器 LDO，或高效率同步降压开关电源 DC-DC）的连续输出能力必须保证不低于 ![][image5]20。对于功耗及射频链路更宽的 C5、C6、S3 及 P4 系列，稳压芯片的额定输出电流应留出至少 ![][image6] 乃至 ![][image7] 以上的硬件裕度17。

#### **2.1.2 阶梯去耦电容配置**

去耦电容必须采用由大到小的阶梯并联架构，以覆盖低频、中频和高频的阻抗抑制需求19：

* **大容量电容（Bulk Decoupling）**：在稳压输出端及 PCB 供电网络的主物理入口处，放置至少一个 ![][image8]（推荐 ![][image9] 或 ![][image10]）的低 ESR 陶瓷电容或贴片钽电容，用作电荷蓄水池19。  
* **模拟电源（VDDA、VDD3P3）去耦**：在模拟供电引脚附近，除了标准的 ![][image8] 大电容外，必须就近放置 ![][image11] 和 ![][image12] 陶瓷电容进行本地滤波，防止射频工作时的噪声反向灌入模拟 PLL 时钟电路中21。  
* **数字电源（VDD3P3\_CPU、VDDPST）去耦**：在靠近每个数字 VDD 引脚的物理路径上，必须就近放置一个 ![][image12] 的高频去耦陶瓷电容（首选 0402 封装以减少引脚寄生电感）19。  
* **VDD\_SDIO 阻抗控制**：在运行内置或外置 Flash/PSRAM 时，如果芯片内部 VDD\_SDIO 没有引出（如部分内嵌闪存型号），外部 GPIO16 引脚上的拉阻抗最好接 1 M$\\Omega$ 左右的高阻，以最大程度地削减待机期间的静态漏电功耗21。

### **2.2 上电时序与 CHIP\_PU 复位控制**

CHIP\_PU（芯片使能/重置）引脚是高电平有效使能端，内部带有弱上拉21。

* **RC 延时机制**：为确保芯片内部各物理数字供电轨在上电初期已完全建立并达到额定电压，必须在 CHIP\_PU 端配置 RC 延时滤波电路，防止芯片在供电尚未稳压至安全值前过早解除硬复位状态21。官方推荐的标准原理图设计参数为拉电阻 ![][image13]，下地电容 ![][image14]，提供约 ![][image15] 的延迟时间（启动等待时间 ![][image16]，硬维持时间 ![][image17]）21。  
* **电源监控芯片（Voltage Supervisor）的引入**：在电池慢速充电、太阳能光伏弱光起动或频繁插拔电源的严苛物理场景下，电压上升曲线斜率极慢（Slow Power Rise）23。普通的 RC 复位电路可能无法彻底起动，甚至会导致 Flash 擦写时因欠压发生非预期物理擦写失败23。在此类工业和汽车级硬件设计中，必须在原理图上预留一个门槛电压为 ![][image18] 的微型电压监控复位芯片，直接接至 CHIP\_PU，提供完全可靠的欠压硬重置保护23。

### **2.3 引导引脚（Strapping Pins）控制与规避**

在 CHIP\_PU 释放的瞬间，ESP32 内部特定的硬件锁存器（Latches）会对一组被称为“引导引脚”（Strapping Pins）的物理状态进行采样，以决定系统是进入正常的 SPI Flash 固件启动模式，还是进入 UART 串口下载固件模式13。如果这些引脚在外围电路设计中被强行拉低或拉高，会导致芯片启动失败，死锁在非预期状态中25。  
下表详细汇总了经典 ESP32、ESP32-S3 及 ESP32-C3 在上电复位时的核心引导引脚要求，硬件人员在原理图设计阶段必须严格规避对这些引脚的非预期占用：

| 芯片型号 | 引脚名称 | 启动时默认状态（内部阻抗） | 采样电平与系统引导行为 | 硬件外设占用及设计规避指南 |
| :---- | :---- | :---- | :---- | :---- |
| **经典 ESP32** | **GPIO 0** | 内部弱上拉29 | 1: 从 Flash 正常启动 0: 进入串口下载模式 | 通常连接 BOOT 按键及 10 k$\\Omega$ 上拉电阻。运行期间可作为普通 GPIO 输出，上电时严禁强下拉27。 |
|  | **GPIO 2** | 内部弱下拉 | 0 或悬空: 正常启动模式30 | 必须在上电时保持低电平。不可外接上拉型外设（如 LED 灌电流驱动、常开按钮等）30。 |
|  | **GPIO 12** | 内部弱下拉25 | 0: 内部 Flash 电轨 VDD\_SDIO 设定为 3.3 V 1: 内部 Flash 电轨 VDD\_SDIO 设定为 1.8 V25 | **极度危险。** 若外接上拉阻抗导致采样为高，内部 3.3V 闪存将因得不到足够电压（仅 1.8V）而无法起动，导致系统死锁。可通过烧录 eFuse 锁死 3.3V 来解除此引脚限制25。 |
|  | **GPIO 15** | 内部弱上拉 | 0: 关断引导日志输出 1: 开启引导日志输出 | 建议悬空或上拉，可作为高阻输入口使用。 |
| **ESP32-S3** | **GPIO 0** | 内部弱上拉13 | 1: 正常 Flash 启动 0: 串口固件下载模式13 | 接 BOOT 复位切换电路。运行期可用作普通 IO25。 |
|  | **GPIO 3** | 内部弱下拉13 | 决定物理 JTAG 调试接口的配置13 | 除非用于硬件级断点 JTAG 调试，否则必须悬空或保持默认弱拉电平13。 |
|  | **GPIO 45** | 内部弱下拉13 | 0: VDD\_SPI 工作电压为 3.3 V (默认) 1: VDD\_SPI 工作电压为 1.8 V13 | **危险。** 强烈建议悬空，避免任何外接阻抗干扰 Flash 闪存的正常上电工作29。 |
|  | **GPIO 46** | 内部弱下拉13 | ROM 引导阶段调试信息日志输出控制13 | 启动时检测电平，为 0 时开启输出。此引脚严禁强拉高。 |
| **ESP32-C3** | **GPIO 2** | 外部需维持高电平28 | 启动时检测电平，**必须为 HIGH**，若为低则导致闪存引导加载失败28。 | 必须预留高阻测试点，不可接具有低阻下拉特征的外设28。 |
|  | **GPIO 8** | 外部需维持高电平28 | 启动时检测电平，**必须为 HIGH**，否则串口固件下载无法工作28。 | 硬件上电阶段不可将其强制接地。 |
|  | **GPIO 9** | 内部弱上拉28 | 1: 从主 Flash 启动（正常工作） 0: 进入 UART 串口固件下载28 | 功能对应 GPIO 0。在应用中通常接 BOOT 按键，上电时严禁强下拉27。 |

### **2.4 4层 PCB 层叠架构与高频射频布局**

为保证射频通信的最高效能，并使系统具备极佳的电磁兼容（EMC）和抗静电（ESD）性能，乐鑫官方强烈建议使用 **4层 PCB 层叠板（Four-Layer Board）** 进行设计32。

\[Layer 1 (TOP)\]: 信号走线、晶振与高频阻容元件物理排布  
   \=== Prepreg (高频介质层) \===  
\[Layer 2 (GND)\]: 完整的、绝对无信号走线分割的大面积物理接地主参考面  
   \=== Core (核心基材介质) \===  
\[Layer 3 (POWER)\]: 主要电源分配网络铺铜，时钟下方需接地平面进行良好隔离  
   \=== Prepreg (高频介质层) \===  
\[Layer 4 (BOTTOM)\]: 边缘慢速数字控制线、测试点分布层，严禁放置发热或高频元器件

在 4层 PCB 的物理设计中，必须贯彻以下几条高频走线约束准则：

#### **2.4.1 50 Ω 射频微带线精准阻抗控制**

芯片射频物理引脚（LNA\_IN）到板载天线（IFA/MIFA）或 IPEX 射频座之间的走线，在物理形式上必须是特征阻抗为 ![][image19] 的微带线18。

* **物理几何形态**：射频走线应完全敷设在 TOP 顶层，禁止通过过孔（Vias）跨层，路径应尽可能地短直，弯折角度须为 ![][image20] 或圆弧线过渡，严禁出现 ![][image21] 直角32。  
* **CLC 射频匹配架构**：在靠近芯片 RF 输入端口侧，必须放置标准的 CLC（或 ![][image22] 型）高阻抗调谐匹配网络21。阻容元件必须选用超微型 0201 封装（以减少封装带来的寄生电极电容和互感电感），并在布局上呈紧凑的“之”字形（Zigzag）交叉排布，防止相邻贴片器件之间发生高频电磁互调干扰32。  
* **高次谐波抑制 Stub 结构**：为了有效拦截 2.4 GHz 及 5 GHz 通信过程中产生的高频二次/三次谐波，在 4层 PCB 顶层匹配电容的接地端，应设计一段 15 mil 长的短线（Stub）32。该 Stub 的阻抗需控制在 ![][image23]（其参考平面位于第三层，需要物理挖空第二层对应区域），其能起到带阻滤波的作用32。

#### **2.4.2 时钟晶振物理安全区**

无源参考晶振（通常为 40 MHz）是高频敏感组件5。

* **物理物理距离限制**：时钟晶振物理外壳必须置于芯片时钟引脚最前方，且与芯片时钟输入端保持至少 ![][image24] 的安全间距，杜绝起振时高频电场对周边数字电路线路产生高次谐波串扰32。  
* **包地屏蔽环（Guard Ring）**：晶振和匹配电容的外围及下部走线，在 TOP 层必须使用宽接地铜箔包裹，并沿四周高频缝合过孔直连 Layer 2 GND 地平面19。严禁在晶振时钟线的正下方（INNER 1、INNER 2 或 BOTTOM 层）穿过任何高频数字总线、开关电源电轨或控制网络32。

#### **2.4.3 天线净空区（Keep-out Zone）物理挖空与介质 Detuning 调谐效应**

天线是将高频射频信号辐射到自由空间的唯一出口18。

* **空间净空**：对于 IFA 倒 F 型板载 PCB 铜箔天线，天线本体投影区及往外至少 ![][image25] 范围内的所有 PCB 物理层（TOP、INNER 1、INNER 2、BOTTOM），严禁有任何铜箔分布、信号走线或任何物理过孔/金属定位螺丝孔18。  
* **FR4 基材完全切割挖空（FR4 Dielectric Detuning）**：即使在天线区域清空了所有金属铺铜，环氧树脂（FR4）板材本身固有的高介电常数（![][image26]）依然会作为高阻电磁介质阻抗加载在天线上，将天线的电磁谐振频率强行向低频频段拉低（Detuning 效应），导致天线失谐，严重削弱 Wi-Fi / BLE 搜网能力18。因此，最优的 PCB 物理布局是直接将模组或天线贴片部分突出在主 PCB 板的外边缘悬空排布18。如果受限于外壳机械尺寸不得不放置在 PCB 内部，必须使用物理机械铣刀对天线正下方及四周区域的整个 FR4 玻璃纤维板材执行物理镂空切除，实现彻底的空气介质隔离，以确保射频信号辐射效率18。

### **2.5 工作功耗指标与低功耗模式矩阵**

ESP32 在芯片微架构级设计了分立的物理供电轨开关（Power Domain Gating）与动态电轨跳变管理机制5。在非高频业务处理状态下，能够对不同的数字、射频、甚至存储 SRAM 分区执行不同层级的截电和时钟门控（Clock Gating）处理，从而支持物联网传感器在极窄的电池电能约束下连续服役5。  
下表汇总了 ESP32 芯片在不同工作模式下的典型瞬时电流与硬件存活状态指标：

| 物理功耗状态 | 射频 PA 状态 | CPU 核心状态 | 系统 SRAM 状态 | RTC 域与 ULP 状态 | 典型瞬时工作电流 (3.3V) | 典型应用工作负载场景 |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **Wi-Fi 发射模式 (TX Peak)** | 处于最高功率发射 802.11b, \+19.5 dBm 状态14 | 全速运行 (240 MHz) | 全开且高频读写 | 保持工作状态 | ![][image4] \[cite: 14\] | 网络建链、局域网高速数据传输。 |
| **Wi-Fi 接收模式 (RX Peak)** | 保持低噪声接收 LNA 全开监听14 | 全速运行 (240 MHz) | 全开且高频读写 | 保持工作状态 | ![][image27] \[cite: 14\] | 等待下行指令，执行无线侦听。 |
| **蓝牙接收模式 (BT RX Peak)** | 经典蓝牙/BLE 接收链路全开14 | 全速运行 (240 MHz) | 全开且高频读写 | 保持工作状态 | ![][image27] \[cite: 14\] | 建立蓝牙 A2DP 音频流。 |
| **调制解调器睡眠 (Modem-sleep)** | 完全物理切断供电36 | 运行 (![][image28])14 | 完全保持运行状态36 | 保持工作状态36 | ![][image29] \[cite: 14\] | 离线复杂控制算法，不涉及无线连接。 |
| **轻度睡眠 (Light-sleep)** | 完全物理切断供电36 | 时钟完全挂起暂停 (Clock Gated)36 | 挂起且寄存器完全维持状态36 | 保持工作状态36 | ![][image30] \[cite: 11\] | 等待外部低电平触发中断，保持内存断点。 |
| **深度睡眠 (Deep-sleep)** | 完全物理切断供电36 | 物理断电 (Power Gated)36 | 物理断电36 | 完全存活，ULP 和 RTC 计数器保持运作5 | ![][image31]（C3/C6 最优）3 | 电池供电长寿命定时传感器周期数据采集11。 |
| **休眠模式 (Hibernation)** | 完全物理切断供电36 | 物理断电36 | 物理断电36 | ULP 彻底断电，仅保留极微型 RTC 周期计数器5 | ![][image32]（C6 典型值）15 | 超长期超低功耗设备非工作保存状态。 |

## **3\. 开发环境搭建与固件编译烧录操作**

### **3.1 官方原生开发套件 ESP-IDF 环境控制**

对于工业级量产设备，推荐采用官方原生的 C 语言开发套件 **ESP-IDF** 进行敏捷工程化落地2。在完成物理环境搭建和工具链配置后，系统开发通过以下底层命令行指令对核心进行目标芯片架构切换、配置剪裁、编译、本地固件烧录及实时监视2：

* **编译构建第一步：声明物理目标芯片类型** 在项目根目录（包含 CMakeLists.txt 文件的位置），硬件人员需通过目标芯片声明指令配置项目。该指令会自动配置交叉编译器路径（例如 xtensa-esp32s3-elf- 或 riscv32-esp-elf-）38：  
  Bash  
  idf.py set-target esp32s3

* **编译构建第二步：呼出内核层可视化菜单配置器** 通过以下配置管理指令可以呼出基于文本的交互式菜单：  
  Bash  
  idf.py menuconfig

  在此菜单中，工程人员可以对多核任务调度行为、系统时钟频率（例如由 240 MHz 调低至 80 MHz 运行以节约功耗）、看门狗溢出周期、无线共存共济策略、自定义分区表的偏移量（默认通常为 0x8000 物理扇区）、固件调试日志输出级别等数十个内核参数进行图形化剪裁和配置14。  
* **编译构建第三步：编译生成整机合规固件** 执行多核并行编译：  
  Bash  
  idf.py build

  该过程会将项目代码连同 FreeRTOS、LWIP 网卡协议栈一同进行增量编译，最终输出包含引导加载程序（bootloader.bin）、物理分区表（partition-table.bin）以及主应用程序（app.bin）在内的一整套二进制升级固件38。  
* **编译构建第四步：一键执行本地固件烧录与终端串行监视器（Monitor）运行** 通过串口或内置 USB 调试端口连接物理开发板，执行以下一键式部署指令：  
  Bash  
  idf.py \-p COM3 flash monitor

  本指令会自动扫描物理 COM3 串口（在 Linux 环境下通常指向 /dev/ttyUSB0 或 /dev/ttyACM0），通过板载自动重置电路控制 EN/BOOT 引导引脚跳变28，将二进制映像完整写入对应的 Flash 物理扇区，并在烧录成功后立刻转入实时串口信息流监控终端，实时输出启动加载日志20。

### **3.2 ROM 引导下载模式（BOOT）的强制唤醒机制**

在大多数市售标准开发板上，硬件工程师会设计由 DTR 和 RTS 物理串口流控引脚级联的自动复位及烧录控制电路20。但在某些自定义的 bare-chip（裸片）硬件设计中，由于未配置自动流控，或者由于当前 Flash 固件代码编写中发生了极严重的死锁、高频看门狗硬重启死循环，导致串口烧录机制完全失灵20。此时，必须通过物理按键将芯片强制拉入内部固化的 ROM 下载引导程序中20：

1. **物理引脚状态控制**：按下并持续按住板载的 **BOOT** 键（即直接拉低引导引脚 GPIO 0 或 C3 的 GPIO 9）20。  
2. **触发硬件物理重置**：在保持 BOOT 按键按下的同时，按下板载的 **EN/RST/RESET** 复位按键20。  
3. **释放使能状态**：松开 **EN/RST/RESET** 按键20。  
4. **释放引导控制**：最后松开 **BOOT** 按键20。 此时，ESP32 将彻底中断正在 Flash 中循环崩溃的主应用，转入只读 ROM 中纯净的底层固件引导模式（ROM Boot Loader Mode），并释放物理串口资源44。测试人员即可通过主机命令行下发整片闪存擦除与固件复位写入指令20：

Bash  
python \-m esptool \--port COM3 erase\_flash

若需要一劳永逸地解决某些硬件中由于 GPIO12 采样电平漂移引起 Flash 电轨欠压的偶发死锁问题，还可在下载模式下利用专门的 eFuse 硬件熔丝熔断工具直接锁死内部 Flash 供电：

Bash  
espefuse.py \--do-not-confirm \--port /dev/ttyUSB0 set\_flash\_voltage 3.3V

此操作属于物理熔断，一旦生效，芯片将永久锁定内部 VDD\_SDIO 电平输出为 3.3 V，并在启动阶段完全绕过对 GPIO12 Strapping 引脚的状态采样25。

### **3.3 Arduino IDE 环境搭建与自定义分区应用**

在快速物联网软硬件概念验证阶段，Arduino 生态提供了极低的上手门槛43。

* **支持包导入（Boards Manager）**： 首先打开 Arduino IDE，依次导航至 **文件 \-\> 首选项（Preferences）**，在其中的“附加开发板管理器网址”输入框中，填入乐鑫官方维护的 JSON 索引地址： https://espressif.github.io/arduino-esp32/package\_esp32\_index.json43。 保存后，进入 **工具 \-\> 开发板 \-\> 开发板管理器**，搜索并安装最新版本的 esp32 芯片官方核心支持包43。

#### **3.3.1 默认外设引脚硬映射**

当开发人员在 Arduino 框架下未在代码中显式指定引脚时，系统在编译阶段会根据开发板板级定义，对各种硬件外设接口应用如下默认物理引脚映射（以高频使用的 ESP32-S3 及低耗 RISC-V C3 为代表）：

| 芯片型号 | I2C 默认时钟 (SCL) | I2C 默认数据 (SDA) | SPI2 (HSPI/VSPI) 时钟 (SCK) | SPI2 数据输入 (MISO) | SPI2 数据输出 (MOSI) | SPI2 片选端 (CS) | UART0 默认调试输出 (TXD/RXD) |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| **ESP32-S3** | **GPIO 9** \[cite: 13\] | **GPIO 8** \[cite: 13\] | **GPIO 12** \[cite: 13\] | **GPIO 13** \[cite: 13\] | **GPIO 11** \[cite: 13\] | **GPIO 10** \[cite: 13\] | **TXD: GPIO 43 RXD: GPIO 44** \[cite: 24\] |
| **ESP32-C3** | **GPIO 9** \[cite: 30\] | **GPIO 8** \[cite: 30\] | **GPIO 6** \[cite: 30\] | **GPIO 2** \[cite: 30\] | **GPIO 7** \[cite: 30\] | **GPIO 10** \[cite: 30\] | **TXD: GPIO 21 RXD: GPIO 20** \[cite: 30\] |

由于 ESP32 芯片内部集成了功能强大的 **GPIO Matrix（GPIO 矩阵功能开关）**，除了一部分对频率和信号边沿要求极高的特殊引脚（例如运行在 80 MHz 主频下的 QSPI 闪存总线引脚，必须强制直连 IOMUX 专用物理通路外）13，**几乎所有常用的外设功能（包括 I2C、通用 SPI、通用 UART 等）在软件初始化阶段，均支持被任意重映射（Remap）至任何闲置的可用 GPIO 物理引脚上**，具有极高且灵活的物理布线便利度13。

## **4\. 物联网基础功能开发：Wi-Fi 连接架构剖析**

在 ESP32 软件体系下，Wi-Fi 连接的核心是一套**事件驱动型（Event-Driven）的异步网络状态机架构**39。在底层运行过程中，硬件无线网卡物理层、LWIP 网卡协议栈以及用户的应用业务逻辑任务分别在 FreeRTOS 中作为独立线程调度运行39。它们之间完全通过“事件组标志位（Event Group Bits）”以及由内核派发的“系统事件循环（Event Loop）”进行高效率、非阻塞的信号传递与状态同步39。

### **4.1 网络初始化与接口绑定**

在调用 Wi-Fi 库之前，系统必须依次完成初始化。首先运行底层非易失性存储（NVS Flash），该区域是乐鑫专用于存储 Wi-Fi 内部校准和射频调谐常数的片外闪存物理区域39。 随后调用 esp\_netif\_init() 初始化内部 TCP/IP 协议栈39。 再通过 esp\_netif\_create\_default\_wifi\_sta() 指令在物理驱动层与 LwIP 网卡接口层之间建立逻辑 Station（客户端）绑定39。该操作会在协议栈内部自动关联 DHCP 客户端（DHCP Client）39。

### **4.2 事件泵与非阻塞异步处理机制**

Wi-Fi 搜网和物理连接是一个耗时且伴随射频干扰的异步物理过程39。ESP32 杜绝使用轮询或死循环的方式去检测网线连接，而是使用统一的系统级事件分发器，在接收到特定的射频硬件通知后自动触发并回调之前注册完毕的回调函数（event\_handler）39：

* WIFI\_EVENT\_STA\_START（当物理射频芯片已成功初始化就绪并完成热启动）39；  
* WIFI\_EVENT\_STA\_DISCONNECTED（当连接发生中断、信号骤降或者路由器执行拒绝服务时的断链）39；  
* IP\_EVENT\_STA\_GOT\_IP（当 LwIP 成功接收到路由器的 DHCP 应答、分配了 IP 地址及网关路由，此时连接才真正宣告建立完毕）39。

主应用进程在发出 esp\_wifi\_connect() 的指令后，即主动调用 FreeRTOS 事件等待函数 xEventGroupWaitBits() 释放 CPU 调度权而进入低功耗挂起状态39。直到在事件处理器中被异步派发的 WIFI\_CONNECTED\_BIT 或 WIFI\_FAIL\_BIT 信号唤醒，整个过程不会对其他实时运行的电机控制、传感器监测等高优先级任务造成阻碍，最大程度上满足了物联网产品的实时响应性能需求39。

## **5\. 固件在线升级 (OTA) 架构设计**

在工业化大规模物联网部署场景中，固件在线升级（OTA）是保障产品运行安全、持续优化以及及时消除零日安全漏洞的关键手段46。

### **5.1 OTA 分区布局与双槽（Ping-Pong）回滚保障**

为防止在不稳定的无线通信环境中由于突然断电、网络崩溃或新固件存在严重软件崩溃（导致系统持续死机重启）而导致现场设备彻底变砖50，ESP32 在闪存文件系统上强制引入了 **双区（Ping-Pong）交叉冗余备份机制**49。  
如前文自定义分区表所述，在任何时点，系统的 Bootloader 引导装载程序都会首先读取 otadata 分区中记录的二进制标志位50。如果当前设备正常在 ota\_0 区运行，当通过网络触发 OTA 更新时，新下载的明文二进制数据流会被完全写入暂处于空闲态的 ota\_1 扇区中51。只有当全片固件数据接收校验完整无误后，esp\_ota\_set\_boot\_partition() 函数才会去修改 otadata 分区的控制标志，将当前的逻辑启动位置设定为 ota\_1，并命令系统发出硬重启52。  
当使能了内核级回滚支持（通过 menuconfig 启用 CONFIG\_BOOTLOADER\_APP\_ROLLBACK\_ENABLE 选项）后，OTA 数据指针更新并非代表升级成功51。当系统首次尝试引导全新的 ota\_1 区固件时，该固件的默认运行标记将被标记为“待确认新镜像”（ESP\_OTA\_IMG\_PENDING\_VERIFY）52。

* **首次启动校验**：如果该新固件在首次运行过程中因堆栈溢出、硬件寄存器异常、连接路由器失败等故障导致未执行用户级的“验证存活”功能，并在一定时间内触发了看门狗复位20，Bootloader 将在上电复位时检测到此异常52。  
* **物理回滚**：Bootloader 会判定该新固件失效（标记为 ESP\_OTA\_IMG\_ABORTED 或 INVALID）52，随即自动将 otadata 引导地址重新复写、指向之前确定处于 100% 正常运行态的备份分区，从而确保设备不失联52。用户固件在稳定运行并完成自检后，必须通过调用 esp\_ota\_mark\_app\_valid\_cancel\_rollback() 强制将本分区状态标记为“合法”（ESP\_OTA\_IMG\_VALID），固件升级过程方宣告完美落幕。

### **6.2 企业级无线蓝牙 OTA 安全架构：AWS IoT FreeRTOS BLE OTA 部署**

在某些特殊的工业手持、穿戴或全密封物联网终端上，由于直接禁用了 Wi-Fi 功能（例如为了电池极度长寿命考虑使用 ESP32-H2），或者设备处于无外网连接的局域网盲区2，此时可以通过低功耗蓝牙（BLE）级联企业级云平台（如 AWS IoT 配合 FreeRTOS）完成固件的安全升级40。

\+--------------------+            \+-----------------------+            \+-----------------+  
|   Amazon S3 S4     | \<--- 1\.    |   AWS Signer Profile  | \<--- 2\.    |  Amazon Cognito |  
| (Firmware Storage) |   Upload   | (Sign code using ACM) |   Authorize| (Authentication)|  
\+---------+----------+            \+-----------+-----------+            \+--------+--------+  
          |                                   |                                 |  
          \+-----------------+-----------------+                                 |  
                            |                                                   |  
                            v (3. Transfer via BLE GATT Service)                 |  
                  \+--------------------+                                        |  
                  |  Mobile App (Host) | \<--------------------------------------+  
                  \+---------+----------+  
                            |  
                            v (4. Flashing in chunks over OTA Data)  
                  \+--------------------+  
                  |  ESP32 Target Chip |  
                  \+--------------------+

#### **6.2.1 企业云端安全基础配置**

在 AWS IoT 云平台与 ESP32 客户端之间实现 BLE OTA 连接，需要构建一套严密的基于椭圆曲线（ECDSA）的设备证书验证与云端资产授权链路40：

1. **存储桶资产分配（S3 Bucket Setup）**：首先在 Amazon 简易存储服务中创建一个专用的 S3 存储桶，并开启版本控制功能，专门用作安全升级固件二进制包的云端分布式物理存储介质40。  
2. **创建服务代理服务角色（OTA Service Role）**：在 AWS 身份与访问管理（IAM）平台中，配置一个专用的 OTA 执行服务角色，为其赋予以下四个官方管理的最小权限安全策略包，确保云服务在固件分发阶段能够合法访问设备阴影与日志网络40：  
   * AWSIotLogging（日志审计）；  
   * AWSIotRuleActions（规则路由转发）；  
   * AWSIotThingsRegistration（物理网关注册绑定）；  
   * AWSFreeRTOSOTAUpdate（云端分发核心权限控制）。  
3. **构建物理级代码签名证书（Code-Signing Certificate）**： 在本地通过 OpenSSL 安全工具链生成基于 ECDSA 的物理密钥对（例如采用 secp256r1 算法标准），使用安全终端指令将用于签名验证的公钥证书上载至 AWS 证书管理器（ACM）中，用作云端固件防篡改签名服务器的源头40：  
   Bash  
   aws acm import-certificate \--profile=ota-update-user \--certificate file://ecdsasigner.crt \--private-key file://ecdsasigner.key

   上传完毕后，云端控制台会返回一个专用的 ARN 全球资源标识码40。硬件安全人员随即利用此证书在 AWS Signer（代码签名服务）中配置物理签名配置文件（Signing Profile）40：  
   Bash  
   aws signer put-signing-profile \--profile=ota-update-user \--profile-name esp32Profile \--signing-material certificateArn=arn:aws:acm:us-east-1:123456789012:certificate/abc-123-efg \--platform AmazonFreeRTOS-Default \--signing-parameters certname=/cert.pem

4. **身份令牌认证（Amazon Cognito Authentication）**：由于设备在固件拉取阶段需要通过手机端应用（作为 BLE Gateway）进行授权代理，需要在云端配置 Cognito 用户池，为移动终端、物联网调试员分配临时的 AWS 调用凭证，确保其获得拉取 Amazon S3 升级大固件的专有加密下载链接（Presigned URL）40。

#### **6.2.2 物理层 BLE GATT OTA 属性配置**

在客户端 FreeRTOS 系统中，蓝牙 OTA 进程会将自身虚拟为一个标准的 BLE 属性外设（GATT Server）51。通过在属性表（Attribute Table）中注册一个由 128-bit 自定义 UUID 定义的“OTA 服务（OTA Service）”51，该服务主要暴露出以下两个特定的功能特征通道51：

* **OTA 控制特征（OTA Control Characteristic）**：用于写入开始升级指令、宣告固件总长度（Byte）、传输段（Chunk Size）的分片规则、校验码，以及接收芯片反馈的实时传输断点断层状态指示51。  
* **OTA 数据特征（OTA Data Characteristic）**：专用的高速无回复数据流下发通道（支持 WRITE\_WITHOUT\_RESP 属性，以在协议栈底层绕过每一次数据分包的回执确认过程，提升实际传输速率）51。由于手机和芯片均支持调整最大传输单元（MTU），在 BLE 5.0 模式下，最大 MTU 通常可被协商扩充至 247 字节以上。  
  * *传输速率与效率*：如果使用具有重传校对回执的“指示”（Indication）或“带回复写入”属性通道，数据的无线实际吞吐率将被死锁在约 ![][image33] 的低位水平53。而通过在 OTA Data 特征通道上直接采用非阻塞异步通知（Notification）及无回复写入机制，可以将实际的空中物理固件传输速率直接提升约 4 倍，达到 ![][image34]，大幅缩短蓝牙现场更新大固件时的等待时间53。

## **6\. 常见故障诊断与优化方案**

### **6.1 褐出复位（Brownout Reset）的成因与消除**

如硬件设计章节所述，当芯片监控到 3.3V 导线上的瞬态电压低于内部硬门槛（如 ![][image35]）时，就会强制触发硬复位22。但在某些紧凑型电池或超微型开发板上（如高度集成相机的 ESP32-CAM 模块），物理空间不允许并联大电容，或者外壳机械设计要求使用廉价的 USB 延长线20。此时，可采用软硬结合的“组合拳”策略彻底切断这一问题22：

#### **6.1.1 软件时序避峰管理**

在固件开发中，彻底抛弃传统的“开机即连网”的常态化编程逻辑55。

* **第一步：冷启动初醒时强制完全关闭 Wi-Fi 射频后端**：在 app\_main 的第一行代码，不要使能网络栈，甚至直接调用物理射频截断指令，让芯片在上电瞬间以最低的数字处理器主频工作，确保内部 PMU 彻底安稳度过开机初期的振荡起振过渡区55。  
* **第二步：分时段顺序控制高能耗传感器**：如果系统挂载了相机、电机等强电外设，首先在未连接 Wi-Fi 之前，分次对这些设备供电并进行数据采集56。  
* **第三步：彻底关闭不相关外设后，方允许启动 Wi-Fi 射频搜网**：采集结束后，立即将所有的传感器完全拉低使能端进入休眠断电态56。此时，通过 esp\_wifi\_start() 启动 Wi-Fi，此时由于整机只有单芯片一个能耗大户，可以安全地将瞬间脉冲电流消耗让渡给 Wi-Fi，从而防止了因为外设并存、电网满载导致的过载电压突塌55。

#### **6.1.2 针对特定开发板的适配与临时避难方案**

在 ESP32-CAM 模块上，初学者常将其 3.3V 输入引脚直接连在外部低性能 FTDI（USB 转串口模块）的 3.3V 辅助输出端54。由于大部分 FTDI 上集成的 3.3V LDO 仅能输出不超过 ![][image36] 的极微弱电流，这百分之百会导致开机直接进入反复不断的 Brownout 死循环20。

* *解决方案*：必须改用 USB 串口适配器上的 **5V** 强输出端，直接物理级联到 ESP32-CAM 开发板的 **5V** 主输入引脚，借助于板载的大容量高电流 LDO（如 AMS1117-3.3 芯片）为 CPU 提供坚固的 3.3 V 射频电轨支撑54。若在紧急工业测试下确实由于电磁干扰严重无法抑制，可由专业底层固件人员在引导代码首部（如自定义 Bootloader）调用底层 API 将检测阈值强制下调或完全关断，但此方法仅属掩耳盗铃式的临时过渡方案，必须尽快通过重新敷设 PCB 地、电源线加粗并配置低 ESR 滤波电容等物理优化从根本上消除供电物理隐患20。

### **6.2 存储溢出、看门狗重启与内存优化**

在物联网多线程业务开发中，开发者会经常遭遇系统自动软重置并报出 Core Dump 栈指针崩塌信息20。其典型病因包括20：

* **看门狗溢出（Task Watchdog Timeout）**： 这是由于系统中某个分配了极高优先级的应用任务（Task），由于陷入了长时间死等的 while(1) 或同步等待外设通信的物理逻辑循环体，导致低优先级的 FreeRTOS 闲置任务（IDLE Task）在规定的看门狗时限内（通常默认设为 5 秒）无法获得分时调度，看门狗因此判定主系统发生灾难性跑飞死锁而强制让系统发生自我保护式的复位20。  
  * *修复方案*：开发人员绝对不允许在任何 Task 或主 loop 循环中设计长期完全阻塞的纯空循环体20。在任何有循环等待逻辑的地方，必须插入非阻塞的时间让渡机制（如显式调用 FreeRTOS 挂起调度 API：vTaskDelay(1) 或 Arduino 抽象的 delay(1)），告知 FreeRTOS 调度器当前任务自愿放弃当前的 CPU 分时片，挂起自己 1 个时钟滴答，从而让闲置线程获得一次调度权，及时完成底层看门狗喂狗（Reset Watchdog）的操作20。  
* **任务深度堆栈溢出（Stack Overflow）**： 物联网程序常涉及大块 JSON 协议报文的封包与解析46。若开发人员在分配堆栈较窄的实时任务线程中，以局部变量的方式直接声明了高容量的字符数组（例如 char json\_buffer\[2048\];），这些临时数据会瞬间冲爆该线程在创建时向内核申请的局部栈空间（Stack），导致 CPU 物理栈指针在指针自增过程中非法改写并覆盖了邻近任务的核心存储控制块20。  
  * *修复方案*：针对超过 256 字节以上的大型临时字符处理缓冲区、图像缓存或网络数据帧，应当完全禁止在栈上以局部临时变量的形式创建20。应该移入全局作用域中进行静态（static）持久分配，或者显式使用 malloc()（或针对多片外内存芯片调用 heap\_caps\_malloc()）动态在系统主内存堆（Heap）中分配20。在使用完毕后，必须紧接着调用 free() 释放内存控制块，从而保持微控制系统物理运行内存的高水位线与实时灵活性20。

#### **引用的著作**

1. ESP32 \- Wikipedia, [https://en.wikipedia.org/wiki/ESP32](https://en.wikipedia.org/wiki/ESP32)  
2. There's more than one ESP32, and here are the differences between all of them, [https://www.xda-developers.com/more-than-one-esp32-differences-between-all/](https://www.xda-developers.com/more-than-one-esp32-differences-between-all/)  
3. ESP32 Comparison Chart: All 9 Models, Versions & Variants (2026) \- ESPBoards, [https://www.espboards.dev/blog/esp32-soc-options/](https://www.espboards.dev/blog/esp32-soc-options/)  
4. ESP32 Selection Guide \- 2026 \- DroneBot Workshop, [https://dronebotworkshop.com/esp32-2026/](https://dronebotworkshop.com/esp32-2026/)  
5. ESP32 Series \- Espressif Systems, [https://www.espressif.com/sites/default/files/documentation/esp32\_datasheet\_en.pdf](https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf)  
6. What the ESP32 Family Is Good For: Mainstream Models, Application Scenarios, and Its Place in IoT Edge Intelligence \- Ampheo, [https://www.ampheo.com/blog/what-the-esp32-family-is-good-for-mainstream-models-application-scenarios-and-its-place-in-iot-edge-intelligence](https://www.ampheo.com/blog/what-the-esp32-family-is-good-for-mainstream-models-application-scenarios-and-its-place-in-iot-edge-intelligence)  
7. ESP32-S3 Wi-Fi & BLE 5 SoC | Espressif Systems, [https://www.espressif.com/en/products/socs/esp32-s3](https://www.espressif.com/en/products/socs/esp32-s3)  
8. ESP32-S2 Series \- Datasheet Version 1.8 \- Espressif Systems, [https://documentation.espressif.com/esp32-s2\_datasheet\_en.pdf](https://documentation.espressif.com/esp32-s2_datasheet_en.pdf)  
9. ESP SoCs \- Espressif Systems, [https://www.espressif.com/en/products/socs](https://www.espressif.com/en/products/socs)  
10. The Powerful ESP32 Family: Differences and similarities. \- Makers Electronics, [https://makerselectronics.com/2025/08/09/exploring-the-esp32-family/](https://makerselectronics.com/2025/08/09/exploring-the-esp32-family/)  
11. WiFi Module Power Consumption: ESP8266 vs ESP32 in Deep Sleep \- Zbotic, [https://zbotic.in/wifi-module-power-consumption-esp8266-vs-esp32-in-deep-sleep/](https://zbotic.in/wifi-module-power-consumption-esp8266-vs-esp32-in-deep-sleep/)  
12. ESP32 \- Hardware Design Guidelines, [https://vdoc.ai-thinker.com/\_media/esp32/esp32\_hardware\_design\_guidelines\_en.pdf](https://vdoc.ai-thinker.com/_media/esp32/esp32_hardware_design_guidelines_en.pdf)  
13. ESP32-S3 Pin Reference | Wiki.js \- FluidNC, [http://wiki.fluidnc.com/en/hardware/ESP32-S3\_Pin\_Reference](http://wiki.fluidnc.com/en/hardware/ESP32-S3_Pin_Reference)  
14. Insight Into ESP32 Sleep Modes & Their Power Consumption \- Last Minute Engineers, [https://lastminuteengineers.com/esp32-sleep-modes-power-consumption/](https://lastminuteengineers.com/esp32-sleep-modes-power-consumption/)  
15. ESP32 Power Consumption & Sleep Modes \[All Variants\] \- DeepBlueMbedded, [https://deepbluembedded.com/esp32-sleep-modes-power-consumption/](https://deepbluembedded.com/esp32-sleep-modes-power-consumption/)  
16. Use the Deep Sleep mode to reduce power consumption on an ESP32-H2 Super Mini Development Board | by AndroidCrypto | Medium, [https://medium.com/@androidcrypto/use-the-deep-sleep-mode-to-reduce-power-consumption-on-an-esp32-h2-super-mini-development-board-c37c6c85b460](https://medium.com/@androidcrypto/use-the-deep-sleep-mode-to-reduce-power-consumption-on-an-esp32-h2-super-mini-development-board-c37c6c85b460)  
17. ESP32-P4 Hardware Design Guidelines \- Espressif Documentation, [https://documentation.espressif.com/esp-hardware-design-guidelines/en/latest/esp32p4/index.html](https://documentation.espressif.com/esp-hardware-design-guidelines/en/latest/esp32p4/index.html)  
18. ESP32 Antenna Design Guide: PCB Layout Rules, Keep-Out Zones & Common Mistakes, [https://www.nextpcb.com/blog/esp32-antenna-design-guide](https://www.nextpcb.com/blog/esp32-antenna-design-guide)  
19. ESP32 PCB Design: Best Practices for Power, Layout, and Signal Integrity \- RayPCB, [https://www.raypcb.com/esp32-pcb-design/](https://www.raypcb.com/esp32-pcb-design/)  
20. ESP32 Troubleshooting: Boot Loop, Brownout and Flash Fix \- Zbotic, [https://zbotic.in/esp32-troubleshooting-boot-loop-brownout-and-flash-fix/](https://zbotic.in/esp32-troubleshooting-boot-loop-brownout-and-flash-fix/)  
21. Schematic Checklist \- Espressif Documentation, [https://documentation.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32/schematic-checklist.html](https://documentation.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32/schematic-checklist.html)  
22. Nerd Family – ESP32 Brownout Detector Triggered \- D-Central Technologies, [https://d-central.tech/asic-troubleshooting/nerd-family-esp32-brownout-detector-triggered/](https://d-central.tech/asic-troubleshooting/nerd-family-esp32-brownout-detector-triggered/)  
23. Schematic Checklist \- ESP32-C5 \- — ESP Hardware Design Guidelines latest documentation, [https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c5/schematic-checklist.html](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32c5/schematic-checklist.html)  
24. ESP32-S3 DevKitC Pinout Reference Guide: GPIOs Explained \- Random Nerd Tutorials, [https://randomnerdtutorials.com/esp32-s3-devkitc-pinout-guide/](https://randomnerdtutorials.com/esp32-s3-devkitc-pinout-guide/)  
25. Why Did These LEDs Light Up? ESP32-S3 – Which Pins Are Safe to Use? \[video\], [https://news.ycombinator.com/item?id=38485002](https://news.ycombinator.com/item?id=38485002)  
26. I have found the ESP32-C3 pretty frustrating in terms of occupied pins, once you... | Hacker News, [https://news.ycombinator.com/item?id=38496806](https://news.ycombinator.com/item?id=38496806)  
27. Connecting transistor to pin D9 (MISO) in XIAO ESP32C3 makes that the board cannot start correctly \- Seeed Studio Forum, [https://forum.seeedstudio.com/t/connecting-transistor-to-pin-d9-miso-in-xiao-esp32c3-makes-that-the-board-cannot-start-correctly/284513](https://forum.seeedstudio.com/t/connecting-transistor-to-pin-d9-miso-in-xiao-esp32c3-makes-that-the-board-cannot-start-correctly/284513)  
28. Notes on ESP32-C3 GPIO – Strapping Pins, Flash Pins, etc \- PCB Artists, [https://pcbartists.com/design/embedded/esp32-c3-gpio-notes-strapping-pins/](https://pcbartists.com/design/embedded/esp32-c3-gpio-notes-strapping-pins/)  
29. atomic14/esp32-s3-pinouts \- GitHub, [https://github.com/atomic14/esp32-s3-pinouts](https://github.com/atomic14/esp32-s3-pinouts)  
30. ESP32-C3 Super Mini Pinout Reference \- Last Minute Engineers, [https://lastminuteengineers.com/esp32-c3-super-mini-pinout-reference/](https://lastminuteengineers.com/esp32-c3-super-mini-pinout-reference/)  
31. ESP32 C3 Supermini Pinout \- Page 2 \- 3rd Party Boards \- Arduino Forum, [https://forum.arduino.cc/t/esp32-c3-supermini-pinout/1189850?page=2](https://forum.arduino.cc/t/esp32-c3-supermini-pinout/1189850?page=2)  
32. PCB Layout Design \- ESP32 \- — ESP Hardware Design Guidelines latest documentation, [https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32/pcb-layout-design.html](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32/pcb-layout-design.html)  
33. PCB Layout Design \- ESP32-S3 \- — ESP Hardware Design Guidelines latest documentation, [https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/pcb-layout-design.html](https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/pcb-layout-design.html)  
34. ESP32 Hardware Design Guide: Complete PCB & Schematic Tutorial (2025) \- Schemalyzer, [https://www.schemalyzer.com/en/blog/microcontrollers/esp32/hardware-design-guide](https://www.schemalyzer.com/en/blog/microcontrollers/esp32/hardware-design-guide)  
35. ESP32 antenna performance vs. motherboard size, [https://muehlhaus.com/support/antenna/esp32-antenna-pcbsize](https://muehlhaus.com/support/antenna/esp32-antenna-pcbsize)  
36. ESP32 Active Mode and Deep Sleep Mode Power Consumption Comparison, [https://circuitdigest.com/microcontroller-projects/esp32-active-mode-and-deep-sleep-mode-power-consumption](https://circuitdigest.com/microcontroller-projects/esp32-active-mode-and-deep-sleep-mode-power-consumption)  
37. Bootloader \- Espressif Documentation, [https://documentation.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/bootloader.html?title=ESP32%20%E8%93%9D%E7%89%99%E9%85%8D%E7%BD%91%E7%94%A8%E6%88%B7%E6%8C%87%E5%8D%97](https://documentation.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/bootloader.html?title=ESP32+%E8%93%9D%E7%89%99%E9%85%8D%E7%BD%91%E7%94%A8%E6%88%B7%E6%8C%87%E5%8D%97)  
38. espressif/esp\_hosted \- 1.2.1 \- Example host\_nimble\_bleprph\_host\_only\_uart\_hci \- ESP Component Registry, [https://components.espressif.com/components/espressif/esp\_hosted/versions/1.2.1/examples/host\_nimble\_bleprph\_host\_only\_uart\_hci?language=en](https://components.espressif.com/components/espressif/esp_hosted/versions/1.2.1/examples/host_nimble_bleprph_host_only_uart_hci?language=en)  
39. Building a Robust Wi-Fi Connection System with ESP-IDF \- Medium, [https://medium.com/engineering-iot/building-a-robust-wi-fi-connection-system-with-esp-idf-adfb42103a5f](https://medium.com/engineering-iot/building-a-robust-wi-fi-connection-system-with-esp-idf-adfb42103a5f)  
40. Tutorial: Perform OTA updates on Espressif ESP32 using FreeRTOS Bluetooth Low Energy, [https://docs.aws.amazon.com/freertos/latest/userguide/ota-updates-esp32-ble.html](https://docs.aws.amazon.com/freertos/latest/userguide/ota-updates-esp32-ble.html)  
41. Station Example \- \- — ESP-Techpedia latest documentation \- Espressif Systems, [https://docs.espressif.com/projects/esp-techpedia/en/latest/esp-friends/get-started/case-study/wifi-examples/station-example.html](https://docs.espressif.com/projects/esp-techpedia/en/latest/esp-friends/get-started/case-study/wifi-examples/station-example.html)  
42. Require example code of Arduino/ESP32 to download .bin file for OTA update through http or ftp \- Stack Overflow, [https://stackoverflow.com/questions/77797628/require-example-code-of-arduino-esp32-to-download-bin-file-for-ota-update-throu](https://stackoverflow.com/questions/77797628/require-example-code-of-arduino-esp32-to-download-bin-file-for-ota-update-throu)  
43. Setting up ESP32 on Arduino IDE: Step-by-Step Beginner's Guide | SunFounder, [https://www.sunfounder.com/blogs/news/setting-up-esp32-on-arduino-ide-step-by-step-beginner-s-guide](https://www.sunfounder.com/blogs/news/setting-up-esp32-on-arduino-ide-step-by-step-beginner-s-guide)  
44. ESP32-S3 partition tables and optimizing memory for Arduino IDE 2.x, [https://forum.arduino.cc/t/esp32-s3-partition-tables-and-optimizing-memory-for-arduino-ide-2-x/1320358](https://forum.arduino.cc/t/esp32-s3-partition-tables-and-optimizing-memory-for-arduino-ide-2-x/1320358)  
45. 1\. Getting started with MicroPython on the ESP32, [https://docs.micropython.org/en/latest/esp32/tutorial/intro.html](https://docs.micropython.org/en/latest/esp32/tutorial/intro.html)  
46. ESP32-C5 Partition Scheme & PSRAM: Arduino IDE Guide \- Tutoduino, [https://tutoduino.fr/en/partition-esp32-arduino-en/](https://tutoduino.fr/en/partition-esp32-arduino-en/)  
47. Network Configuration \- ESP32 \- — ESP-Jumpstart Programming Guide 1a719f4 documentation \- Espressif Systems, [https://docs.espressif.com/projects/esp-jumpstart/en/latest/esp32/networkconfig.html](https://docs.espressif.com/projects/esp-jumpstart/en/latest/esp32/networkconfig.html)  
48. Bare minimum wifi connection function for esp32, [https://esp32.com/viewtopic.php?t=22650](https://esp32.com/viewtopic.php?t=22650)  
49. ESP32 OTA Updates: A Complete Guide to ArduinoOTA and ElegantOTA Firmware Upgrades | SunFounder, [https://www.sunfounder.com/blogs/news/esp32-ota-updates-a-complete-guide-to-arduinoota-and-elegantota-firmware-upgrades](https://www.sunfounder.com/blogs/news/esp32-ota-updates-a-complete-guide-to-arduinoota-and-elegantota-firmware-upgrades)  
50. ESP32: Update Over-The-Air using WiFi and the Arduino IDE \- Sebastian Hirnschall, [https://blog.hirnschall.net/esp32-ota-update/](https://blog.hirnschall.net/esp32-ota-update/)  
51. OTA Update Your ESP32 via BLE Without External Libraries \- Part 1 | Michael Angerer, [https://michaelangerer.dev/esp32/ble/ota/2021/06/01/esp32-ota-part-1.html](https://michaelangerer.dev/esp32/ble/ota/2021/06/01/esp32-ota-part-1.html)  
52. Over The Air Updates (OTA) \- ESP32 \- Espressif Systems, [https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/ota.html)  
53. Is it posibble using BLE to do OTA · Issue \#2075 · espressif/arduino-esp32 \- GitHub, [https://github.com/espressif/arduino-esp32/issues/2075](https://github.com/espressif/arduino-esp32/issues/2075)  
54. Any solution available for for ESP32-cam 'Brownout detector was triggered' error?, [https://stackoverflow.com/questions/60171641/any-solution-available-for-for-esp32-cam-brownout-detector-was-triggered-error](https://stackoverflow.com/questions/60171641/any-solution-available-for-for-esp32-cam-brownout-detector-was-triggered-error)  
55. Solving the “Brownout Detector Was Triggered” Issue on ESP32: WiFi Connection After Deep Sleep \- YouTube, [https://www.youtube.com/watch?v=dnkXemrXRcU](https://www.youtube.com/watch?v=dnkXemrXRcU)  
56. ESP32 Brownout Detector Errors And Random Resets \- UNIVERSAL-SOLDER Electronics, [https://www.universal-solder.ca/troubleshooting-esp32-brownout/](https://www.universal-solder.ca/troubleshooting-esp32-brownout/)

[image1]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACUAAAAWCAYAAABHcFUAAAAAm0lEQVR4XmNgGAWjYBSMglEwCmgOGIE4HIifAvFfIF4JxDIoKhCAG4hT0QVpAVyBeCsQqwGxGBAnA/F1ILZEVgQF4kCcgy5IbcACxK0MEMuQgQoQnwDiJCBmhoqB6BIgdocpohUQAeJSdEEoEALiVUB8C4jnAvE5IJ4KxKzIimgBQBZIogsiAVB6A0VrCBAbMyBCbRSMglEw7AAAZ2wOPseZv+AAAAAASUVORK5CYII=>

[image2]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABwAAAAWCAYAAADTlvzyAAAAlklEQVR4XmNgGAWjYBSMgmELGIE4HIifAvFfIF4JxDIoKhCAG4hT0QVJBa5AvBWI1YBYDIiTgfg6EFsiK4ICcSDOQRckBbAAcSsDxCBkoALEJ4A4CYiZoWIgugSI3WGKyAEiQFyKLggFQkC8CohvAfFcID4HxFOBmBVZEakApFkSXRAJgOIXFNQhQGzMgPDtKBgFwxQAAMPjDj4JS5s9AAAAAElFTkSuQmCC>

[image3]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC4AAAAWCAYAAAC/kK73AAAAnUlEQVR4Xu3SMQrCMBiG4Yg6dRNRBEfxAk4eQHoBwV1xc6xH8AiOHkD33sGpa6F7j1HwDaY0zQUC+r3wEPj5hxBijFJKKaX+qAEOqNHgiWVvoyvBORzGaocca8xwQomtv+Sa4xIOYzTCzXwv5LfCG0cM3cyeGdJ2KWZTXMOha4IXKjxQ4I6xvxQre4lFOPSy/99+oT02pnt9pZT6oT4K9Q4+03YNMgAAAABJRU5ErkJggg==>

[image4]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJEAAAAWCAYAAADAbX5DAAADjklEQVR4Xu2ZS8hNURTH1xeKkJBXkUceKUKYyGOCKKQYeHyhfErIgKI8SsnEEKVESORRZCCvQhkQRvIqSkSSMGGAxP9v7eXuu51zuPWdS+761T/3W2fvc497/mettfcRcRzHcRzHcf53FkCT06BTPgNEf/w8hkE7oX1QM9Sx+vAPOkCLRMdwLOfUmy7QTegc1D455pTAcGgVdAX6Ch2uPvyTedBJ0fF9obXQbah/NIY37zK0HeoEjYYeiM6tJxOhL9Bb0et1SoY/8lxoAvRCsk3UC7ogah6jCdoDbYtiG0WN1TWKLYYeip6jXtDET6Fv0JrkmFMifaBnkm2isdAjaEgSp2n2h880Dg2Uzh8PfYDmJPGy4HWchpaKZiOanyXWqQNFJhoEvYKeQFNCjKXrklTMwYzG8pHOpwE/QjuSuMGyxww3XfQc7aBxotmxXxjDrDcUmh/GtAnxLFjKDkA9RE39HhpRNcIpjSIT8SZuEC0P1EHoLLQ+HCNmlnR+XtygWV6KnpfN+BHRErhZdF5LiK+DVoaxLKNtOTkDljJbHNC4XtLqSJGJCJ9+uynUG2iaVEw0O8TT+b8zEWEmYj8W906doevQJ2hSiBFeA6+T15tipWxg+Nsa7FpLWm/ohOhCg6ZdKPnZj98xJg02KkUmolH4NLN8sQFnFqJh+CMvCWNmhlg6/09MZN+9K4qxzF0TNRINZbAPyzORlTLLUtan1VLSaLbj0AqoGzQKOgPtDcdSmPV8BRgoMhEzzj2p9Ch8KrkXRHNY9sgzS148xr6bBjHMRBQ/G0UmYpZiE/880mepraTRiMuTGP+/LOcXpXqFOhjaLdnmakiKTMQVWJwljBnQO1GjWPOdzjcTbUriMa1horSUGbWWNGYWZp+UJmgW9Fo0E7PcPRZdBDiBIhMxlrW64lN5RzSd201Pd4mnimYD/ptHa5iI5+d1pg13rSWtpxSbjbv0XEmyB+yeHGt47EYelUqzbHAZf1/0tYjBMcugY1K5cc2iJcSyAcdwtcRXENwSyMMa6zhbFZko3YnmTT8EbZVfr534Kq1k+ATzBrJJtpUX+4q70MgwxnoC3rwtokvwU6I9AlcyBvd42IBeFV2600A0H19/5MFlu/Ut1C1RM7JMWoyfGbsRxTiHc1dHMeq8VN7pMavwfPFxnovznL8E0zfTODf9uPmX9dQzZhuDfItOYzmO4ziO4/yrfAf/y9ocAUZqzgAAAABJRU5ErkJggg==>

[image5]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEUAAAAZCAYAAABnweOlAAADIklEQVR4Xu2XTYhOURjHnwlFSBJS5CORUhQSYSUlkWIhlAVJsbKgTEKywA5FSvnIltVEUSbK54KFr6JEZIUNCyT+P899OO+Zue/HmJmN+69fc9/nnnPvOf/znOeeMatUqVKlSpX+QevEkjzYrCaJ9WK8GCAGi1lia3Gdaro4Ik6b9xlSe/u3iHGPNrSlT39rhLgrOqzrHJrSQvFV/Ez4IlakjaQ14qmYLYaJg+Ka+QBCXBPjHm1oSx/69qcWie/ig5iR3WtKc8wH/lw8EgfEuJoWZhPEC7EhiY0UD8SOJLa7iHEvRJ9nYmwS62uxKK/MFzgdX9PClON5MBMTI3toG2oTF0WneVaESeeSNmie+CxWZfG+EuO4JDaZZ8tV636b11UzphyzrqYgDHgvppinKemam0If+h7K4iEMpZ4tM3/GIDFXrDbPUMQCTBNrizbUvjKxdc6I0eaL9EnMrGnRhBj0ZXFevBRvxD6rdZeJlpkS8Zh8mSl5PMTk35mnOsX5gnlmtpv321LEd4ptRdsTYiCduxFbhy8PYiF6tIUY9D0xtfg9Stw3Hwirxkp2WmNTVpoPIJ98I1MQmfLWamvPcHHL/COwuIghJvrautY9FFtncvE7Cm7LW4iJD81ie8wHs6C4d90am7Lcem4KE2SibNNQLAbGYFCIYl5mSmydyKKocz3aQrl4MRMkZVFfbh8UpvDeUJgCXIfqmUIWUdQpAcE3a3ELsVVw8rEYk8TDlBgkLyszhbQn/Sm2FN188mEK2Vem3jAl3zqhlrdQDCY3hQlgSnxG+ftDLP3Twk+KHQVcxyTid4g+rFbaN1dvmMLzWZC8ALe8hXjAKTE/iXEqvWleR+K0GsV3f/EbUZjJkqj0aKN5ysZqtZl/DThypyffXFFo02yqZ0p+UiUDzoq95u/M1fJXaKJ5MTsqNouH4rb5QFNxduCUuMv8vID7h80LdYjrk+KG+acWQ56YH/fLxGc29j1gPuZ+TGJcE7uTxOhD3+1JDK7Y3w8H2c/z0vs8i34NxWT4j7LR4YiXcchKD1a5WKk4aPHM1LRKlSpVqvS/6xes29cE4wocWQAAAABJRU5ErkJggg==>

[image6]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEUAAAAZCAYAAABnweOlAAADLklEQVR4Xu2XS6iNURTH1w1FSLoeKQakK6UozDDxKAOSRwllIhQjA2+lZMDQI6UUSWZmN4pyy4CYGHgMJBEZCCUGyOP/s77l7LPvOefe77rnTnz/+tf51rfX/vb677XW3sesQoUKFSpU+AdsFJfkxrIYJW4Sz4vHxan1r/9glnjSfAxj8cmRzsNYfIYa48R7Yrc4MnvXb8wWH4oHzMXYIN4XJyVj1olPxHniGPGYeNN8AQF+Y+MdYxiLD75DiUXid/G9eWylQeCPzAXpEEeLt8Qv4vxizDTxmbi5eAbjxQfi7sS2r7DxLoDPU3FyYms32JQX4i+rX1+/QSC5okvF/VYrDwJLRQIIeEXsMc+KEOlSMgYsFD+LqzN7u8A6rolbzbPlhjUu86aI2iOYzoJkzrB0kHDKeosCEOCtOMNcVMTNRcEHX/pUIyAoJbvCfI4R4gJxjXmGAjagS1xfjMnXl4LSuSBONI/rozinbkQfiEAQ5qx4SDwtPjbvBwECbSZK2CP4ZqLk9gDBvzFPdZrzZfPMZC34bSvse8Sdxdgz4nCcG4DS4eQBbETpEooF/xTXFjZ25YR5H2AH2cmeYlwrUVaZLyAPvi9RAN95bfW9Z6x4R/wqLi5sgEBfilMSWyBKZ3rxHA23VAnFgsmMCYk9AtxhjRtvIBVlpQ1cFAIkUMo0EJuBMAgUoAc2EyVKJ7Io+lypEporfrJaswzku97O8gEhCgEHQhSYrq2VKGQRTf1Vwm9WsoRI1efW+8O5KHysmSikPelPs6Xp5sGHKAcze4rBECUvnUDpEiLNrlrvu0VaPoDj9Ie47O8Ivyl2F+R3BBHPAXzYrdQ3x2CIwvxsSN6AB1RCy8V3VsuCDqtvtKDT/IZ7tHgGM82zJDo92GKesrFbzMVpwOmW3nxzRKNNs6mVKPm9igy4KB4x/2aO0qcQ94LD5jfA7eZHMgvkrpCCZ8bsNb8voD7i4R/g9znxtvlRiyA08fR4z8ExG3UPER9xPyQ2fmO7m9jwwXdXYoPXzQ8HwJ2L+dL3zIVfv8BFiUC4RMWkObDzPr1Y5WCnusyF419qKlqFChUqVPjf8RtPu91XR2DfMgAAAABJRU5ErkJggg==>

[image7]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB8AAAAZCAYAAADJ9/UkAAABGklEQVR4Xu2UvQrCMBSFr+DgILgpLiJuDj6Aujo4Ogq+gLj6Ai6+gPgAOjgI4iM4OjqI4KyIgrOLgj/nkgTSgCVJJ7EffFC8SU97WksUE/Pj5GEfps2BDUXYNn90gPc+YcMcfKMMe3BFYuM0OLYmCRfwDUfG7Csc3oI1eCL/8BLcwDvcw1xwHA4/rwP5h3fgkMTdv2AzOA4nSjhXPoFVEhfB1Y9hQlsTSpRwrnwJM/L4Qo7VRwnnux3IY/XiOVXvG65XrnCu3jeca+Z/yRkepVcS4dbV+4brlSucq/cJT8E5BStXOFWvwmdksVhShztYMAdk+dbzd5ifGX9a+UrZG9zCirZOJ0siVK1n9Xq78KHN+NxrEvtiYv6MD/cxSEWxUnUiAAAAAElFTkSuQmCC>

[image8]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADQAAAAaCAYAAAD43n+tAAACW0lEQVR4Xu2WPUhVYRjHHzHDMhARkjBRQhAHIdAWcYwoqJBqkJwD8WNoKQgFQRoSXKIpWhqihiCHnIy4c20NLRElCEKgUw4Ofvz/vOfR57z3fc89V+9y8fzgB/c+7znnvv/7fh2RgoKCgtNGDxzzi4Y+uAhfw4fwXLr5RDyF+znchP3JPUHYOAm/wl34Nt18yH34E16FF+ACXIWt9qIa8Excx+959Sb4SFyga15bCgYahcNwXcKBuuAvOG5qbfA7nDa1WqAjdcdvAA3wlYTbyrgE1yQciEG24aCp8eHvYEnciNWKUCCOTkvymSPHayqSFeillAcivHYDXvHqIQZgt1ezHVVCgTjFuCxID7x91BQnKxBrsUChuk8n/CtufShn4Hu4DM+auh+oEc4m9aqIBeJ0Kkm443kDjcAdeMvUOuBvSYckGmgrUXe3mgXilPgi4Y7nDcTO+FOTIXnvdVMj/ghxWs4l9aqIBSKxjsfqlma4Iu5PseslFFLr/hpi+BnzPRdZgZ5LuOO8llv9Za9u0fXDZyhcPx+lPCQJBQptHhXJCnRX3KFrp4f+85SfY/CePUkflDZkO1yC55O2UKBjoYF4tjR4bfzRb3De1HrFjU7WqxLRDuqhzGc/SWoMeRM+TtqIvilUvWYU/oPsGEdAd5T/8Ie4s0MZgn/EdeaBuLeEF+KmQwwdRT6bv8HF/RlOiZtubOPWzSk7Af/JUR8ov3+QY0y3vPDBN8S9KvF1qBJ2anH75yzQ6cnz5aL5Xhdw9Dk69vypa2Jbc93yBn6SOptWWXCd+DtmwanlACJnleKPB9QMAAAAAElFTkSuQmCC>

[image9]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADQAAAAaCAYAAAD43n+tAAACrUlEQVR4Xu2WPWgVQRDHR4yiUVEwmAQFRW1SiIVfTQIpgiREm2inhQh+oFiooCgGsbA0IIqEELCwUCSQFLEQU4VUFmJhK6gIgqCCoCBi9P/P7Lw3t2/fl0+LR+4PP7ib3bvbmZ3ZOZFcuXLlWizqBMNgDNwA27PDC1oKBsG9wGGwMjOjMV0Gv2vgE+gKzyS1FzwDPWAneCL64EWwJMxZBu6A62AbOAG+gVdgc5jzr3RV9PtDkZ1r4Hfp0J5orCBGeAocF90Baj14LrrgXcHWD2bAxnBPHRX98DhocfZGZTt1MB4QDfBdSY8tiKn2FnwV3R2TRelCuLePcPGmTeA9eA3anb1RpRzi7qwK19w5zkmKE2+Dp6LOmeyl9uBu8BKcLMwoBoP4Z8tph5Smp1+oKeUQU+xMuN4CDhSHqovpMwF+gd7sUEbd4CeYBCuisVhM1TeiO2/idx6KpvxyZ48dYilcC/a/0j7R+uGJxwimRPt98EX0UKkmOv8DDDgb05Tp6p2kzKHPAV77bKlLa0WL/4GUpoLXIfAB9MUDZcTFcP5WZ6OTDFz8jniHGDy2lLod4oOjYEQq9xfuyAupcHRGYjqyFTBQPkgpJ80e1xCdP+fuq8qcuSLF45vNa39hhorOzEmx8bIOeHyvK8woldXPTWezOo2dpFIOpQ6PsuLZziZ6PlybTkm2ufGE4iL8SdUmWmtrnC0WU2pesu/yTrLv3QKtYSzlUM2iA8fAd9Ge8s7BguRWUx1gNtj8nI/gsVRurLbAI+Ge37wUbHSSTZvBNFkPrLtmKOsldpJ4fH7bolL4VIpl9cMWwICxuKfBWdF04xiPbjbp06IB8u/m/SOpI93+t3xqrRYNoPUs1uoGd98UYv1wd3z/aWqVO5qbVvyZreXXqGnEOvGtINei1h9OF5+mNPc+eAAAAABJRU5ErkJggg==>

[image10]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADQAAAAaCAYAAAD43n+tAAACZklEQVR4Xu2WT4hOURjGH/mTmEI0EmWys5AkpGZhQc0UG1LKWkQWM4WIpaWNZqEZJSuUxtSMnYVSNsrOcgoppVgIZeHP8/Se13e+853v3pO7+ri/eure95x77nnOed9zL9DS0tLyP7KGukPtiGJDIXaS2kJtSrS20/WvuUT9KtBHant4ppYl1GXqK7U7imvSb9A7uOtmp2tjrsDGPJrEl1OnYIb2JG192Ud9Qq8hXb+kphPNU6+orZ2ujfGdOpI2wBZ8Cvm2HpRqM7CJpoY0wOnoXmjFblGHknhTcob0rtXhWjunPpXI+SR1DNY5NaSc3RzdCxm8AHu2BNVkupPxRJ2cIaXY2XA9Qh3uNOXZS92AvSBnKGUXNQvb1RK0GK9h9eEso+5Rc9SKKJ4aWkpdDfEiNCml2Ui4rzMk0w+oE2lDBaPUd2o8im2kFtFtUrgh1bLkB0+RIaXLBHU8itUZ2g9b7eKjEzbme2pbFJNJvedgFBPpDmkBr4V4LUodTzWnypCfMi+odUlbP1ZSj6kn6K6XnEmPpzUk8+ej+76cod4m+gIb8AP1jBr+0xvYADumn8I+tiV4/VyPYqqfh+g1KXKGcodHMVU7tJP6DJuMJlWCUuonuj+Uscn1sCxZFdpyhhqhIv2G/NfYJ3c3bajAJ6jfJqG0vRhiMjkGq2PH/xSKaqYKTVZp5qfKD+o5ulNOp5TaSg15/Wisd7DiXqDOwdJNbTq69X+o9I/f72l/Hw3SrQ7l8gHYv10JcWqp5vScTAp9X7RYfj8QaNe1O/H3Z6DpdzQPLLepRxiwtKpCdVL689ryz/MbcWaTG/2x0UwAAAAASUVORK5CYII=>

[image11]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACkAAAAaCAYAAAAqjnX1AAABqUlEQVR4Xu2VvStFYRzHf0IpDFIkyksZFJm9DAYpm0lGK2Wx+AuUhcFkUgYZMNokMdqMJkQyWSxIfL/3eX7uc577HJ17OFw5n/p07v095zz3e5+3I5KTk/N/6IIzfvGLtMEr+JbAdftMCX1wHh7BV7gVbf42OuANPIWNXls3PIHbsMprK8CQU3BYTCdZhdQRPYYN0aYC/XBfwm0faCc/HZKjWm2vHEneF0vakPVwBNZ6df1xJRSSU7ti28g0bLWfg6QNuSRmmXDNKUPwAY45tVDIXnho2xKRJmQN3BPzQxxRZVFKg2v/3Jy39sodzVqmIdvhJVx2ahr8ANY59dBIctNmPpLjYkZk0qmFgpNQSP6hNduWiDQhuR7vYI9TG4VPEg1OQiGJv8E+pdyQnEpOqX84u8Fn4YStx4UsC+0k9tT30Gk9g0221gkvxATnUbJh7yP6xilroyhcV3xYdxt9hOdwwLnPR9fjC9yBq3AXzokZyU24AFvEhH6WYv/8fC2mj0zRaeVZxyDNUpwBTqf7/VfQ9eifjxVF3DFTUQzCe4m+9ioSHsQ5f4Z3EDhtRIwJcc4AAAAASUVORK5CYII=>

[image12]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADkAAAAaCAYAAAANIPQdAAACcUlEQVR4Xu2WP2gUURDGRzSgRAkSUBIEMUUkoKBIEFFSiRghEoiNmj7WFgopRBBRFBFshKCFBEkKCxvTKOTARpJK0QiCjYVWahMFBTXfx+x4c2/fnrurp3LsBz/2bt7tu/nen3lPpFKlSpUqtVbrwAkwBa6A7Y3NubQbHAqDv6k94BP4kYOJ5J2ousBDcAGsB7vAEhjzP8rQXnAGLIr+0dnG5j+mQfAZ3AWrXJyfme9rMOniKTExJrnRxU6Cl2Czi8VEkyPgiOiIt8qkzeidsCHRYXArDJpojAbDlzlyy+BoEM+SJfE3TXIWNyTPLWBadCWmNADeS9qkdXoxiGeprMmtYGcQWy2avFfMJH9zWdTYWnAcdLr2n4q93CyepTImmVxN0vvsPHgKul0sls9+cF8yZs+L+4kFIzQT67SZypjsA+/AaRfjTDyStHHr/yt4K/WKWpMcJofl35nkfv8CDriYGQ+PgzAfDsCQ5JzJ8OVfxbNUxuQN0dLvK3jMOBXLh0XzuuQwaSMXmrFOm549TkVN2n68B9a4OAtdaJyKmeRsWnVtKvuzB6IVynRQdP3zaeKloVfinRY1aVXdD6I3zs9XwaakLWaykMbBG7At+U4TvP08ETVGdYtWPC6lfUnMq+jMc1myFvgjagx8E+1jB7gm9QEdFL3x1CTH8oypA9wE82BU1OAL0euSiR3PgVeiZ5vplDRWO/IBPJb6LMTE/fgdfASXwCw4B26DBTAjehfmGfpc1Lz1z0vKs6StkDhi/eCYaNWi8VYpXJY9yZNiHlw1pWbrf5LtR38+tp2yjom2EmcwvLa1nbjveAmvVKmAVgDyyZovZ+kJ9QAAAABJRU5ErkJggg==>

[image13]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAF8AAAAaCAYAAADR2YAqAAADlklEQVR4Xu1YS6hOURReQlHkGZHBpbxCSNyUR55FkVylPEYKAwOPEFK3pGQkE4UByoCUgUQot0hEmXgUGVwDQihhQB7fd9dZtc+6/z7/+e917z+wv/r6711rn/34ztpr7X1EEhISEhISEhK6EQMzlkUPcCS4AlwFjgV751rUiAXgW/BPwPfgD/AX+ABsAnvaA3XCdHCpN2boC64DT4JHwfF5dzuwH66Naz3rfJVA0ReCL8Eb4HpwDXgc/AjuEZ1Dh3Ea/AnOCWwUfLPoRDkAJ9GdaBQd96GoUHvz7jYMAG+Ch8B+4DTwmWjAFKE/eEeqi8817wJ/g/ukfRDOAj+Dt0TnUjNsIq/A4c43AmyN+LoaFJ9bfDn4TSqLTxtfzqDAxsh8LsXz5YtqkeriTwI/SHF/h0WDo9nZS2Gi6Pa5BPZyvpngd/ApONT5ugszpLL4FJzCewE556/gSmcPUVZ8jklhz0t85zNA2MYHQSlwknx4i3eIvk36uPXqhZj4FjReQGvPiIzBi99HdJcbrRDTX602mPjMEHy2JrBw+HzPKr5JdHG7s//rhZj4ZvfCxOwhvPjzRQ8ZFPEduCOz78xslbKCYbVomxbRfkvDJsGB72V/M7+xsxPgEGtYgMHgdfB1DTzY9mQ5xMS3iPMid0T8BvAuuETy6WWyaEEtSruW87d5RzVUyvccnJWdpxxOpt6Iib9MOi8+TymsEfxlcfWgFsekfWYwWD9PwGF5V3VYvuf2CmEL4BG03oiJHxM5Zg9horEdg4+HirlhgwANoqe95ry5DRzrC7jBO8qgUr4neFzjSykqWgZGB9NTWLCqsZabZUz8MaIXRC+ytd/v7CFM/PvgBNHI99HLTNAoeoFaK3rB8jmdc7oi2ob9MAWXQtH5ni+F4vsFVwKL8SLRW19ZclFlERPfBLwqeloxLBatYfyNwed8uyyxzoWF9Yhoamb7y+DUwMcxL4CzRZ9hehoV+AthxcRXcv59UfLiH5DixXQliiKZ250FfHT2P3chb7uM6KIbpxefYP+sc02BbTt4TfTTxSPRIm/gDqbtDHhONAgY0IVgbmsVFdfI7znhpYQT4ET4EjaCp6ST3y86gK3gG8nP85PobrX0wF3HaL0t+rGLwvNkws8MMTCI2I/1+SKz8ddsj0XHoJ2fFswe1sYposFrvn9aH5mK+KZ54ulu4WsBo32caDqbJ/W9kyQkJCQkJCQk/Mf4C/GG8Q1N8MKsAAAAAElFTkSuQmCC>

[image14]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFUAAAAaCAYAAADG+xDjAAACwUlEQVR4Xu2YTYhNYRjHnwlFTEL5yEyurwVG1r5K0yR2imTHEmXBxkdoNsqGYsNCQknCciJJE8XCzpIN8pGVkhTy8f9730fnPPc9977n3DtnRr2/+jVnznvvmfv+7/N+jUgikUgkEv8xM+AmuAOugJP8/emwz18nIlkJn8Iv8CY8BK/B+3AVvAuH/r26fhpwl73ZIQvga/g7wvP+PVFMgcfhd3gETss3y0b4Gb6V+iuVI2U/fAh/wqv55q7BfrF/j2GvaVsMH8HrsMe0BWGgF+APuN20KVPhiJfXdcJQt8F14jo9VqFqxY6Km/4sA/COhNua2CuutI9K62+BnTlmb9aIdrruUFm1XFP4k5XK17VkGXwPX8J+02a5JOM7n1YNlYvrenEjMouGpYRCZZGd9m1kJ5znrwsZFlelp8z9EDOl+YPVSdVQD0vzWrAWfhK3w1FCoS6HD3xbFHzjKPwl3avAE/BNCe/B2X/f2Z4qoU6Gt8UFw4pVuKuxQevzuRi+8z9ZcLwXHao+5ANcYtomIlVCXQhfSX4katB20Q1VKhfJUpWqD4n5JriYcfUdT6qEyhHIituauRcKmoRC5Rdw1rdFMQs+k/ahzoGX4VzbEIAfhs+Klc/MLhatqBIq51M7EjfAb5IPmoRCJXZBa8sZcXPqFtvg6RE3/xTtXy2rxR1tY2XH7EGjiLKh6t7abuazQe+Bm/39olBLswi+EHdamG/a2NmT8KC03r/WhXY69lSjw5yjkaOSaH8ZNLdGF/3riJ6o2o3cKBrwCfwKr8Dd8Jy4PzwocR0YSzgvsrO6GlP+b+K5uJFRhM6nPCneEDcqb8F94iqVU9oBcVMQ+8ojuj6f19yddLQrYnANccdBulRKziMTEB3m3GsyOK4NWiAc3tnfExHofGr3p4kOKNo2JTpgDfwo+WNoogtw455IJJr4A3esp5Bn3CDrAAAAAElFTkSuQmCC>

[image15]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADMAAAAZCAYAAACclhZ6AAACSUlEQVR4Xu2WQUhVQRSG/yihLLFQDDFRRAqhIDA3gtBCAhEjMkJUcFcQLWpR68BcGETgUhBxEQS1cSEEiryVi4IWYS0qECF0pwjaLuz/O3d03nsz90kWStwPPryeO/fOnLlnZh6QkZGR8b/SSPsKgx4X6DM6TvvpifzbB08LvUfn6U86lX97h176mV6mp+gwnaWVfqODRsncoO30O8LJ1NOvdMCLnaHv6X0vdmiopcsIJ6MktmirFztCX9Ic7EsdKtKSGUNxMkJtV2lTQdxxmjbQHlpHj9Oryf9VSZujsPeqOhphk+TQ9Xl6lw7BqkgVVJK0ZBSLJROKOx7SdbpNR+gkbIPR5KzB1uEreoc+gr3rwe8nLZHn9Ck9B0tkGuHxFRFLRiWUQ3jQpZIRbfQHfYvd3U+D0/pcoc1J7Bh9g92yPUs/wJ53KCElWJJYMifpHMKD3ksyuqc2KhWH60trzi8rvS8HS6aafqKLdBA2AWW0wjVOI5aMiA06FvdxyWidOGJ9+cmIbtizKlP5DXY0lCTWgVC9hwattioXzVqM/SQj3KYxSjdgX6rGux8k1oG4DjtQO72YOplJ1HWMP01GbfS/n1gHbJ0VTmoRsToWVfQdfeLFtHD1VdJ+/gi3Adz0YmnJaJ1ovaiNrpWA4yJsHNrmg2i2NSjNvKvNTfqRXvLaXaFL9DG9BTv99em1KGO8QP57X8O2YL3fxb7ADmX99fu/TRdg/ei5Cdju1oW/hHa2a7ADTj9x/iU6TMuTax2+WieKZWRkZOTzCwRvjj2HtCiqAAAAAElFTkSuQmCC>

[image16]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGIAAAAaCAYAAABM1ImiAAAEB0lEQVR4Xu2YW6gVVRjHv0hLLW8kiqgcSUVFlEAlUB9KJBCypBTCBKG8G6SCFyTkSPiQJVGkQi/Rg2jUi1AgGHjAINEQH7xAKllEPgSGkEFK2P/XN4u99uzZZ2Zfcu9yfvBn77PWzOxZ33WtY1ZSUlJSUlJSUlICU6V90sfSCmlw9XR38pp0QnoiPXEfeFY6Lb0iDUzNNcvL0iXpKelx6W3z9Q2PL+o2BklfJeJ7JyBaCYbz0uvSY9XTDTFBuiK9Go2NlM5Kb0RjXcd46Wdpb3qiA5ARZMZ30lvSsOrpQuCA29LsaOwh6bDUZ54hXQUvNFZaLt01N8AYa195aIWHpYXSKelda6xkfmi1joBPpRvSk6nxwAipR1oijTOvDs8kf4ff57147lJpormDY8jGVdI6aaa0QBpQdUUG3EAj+0H60zxiWMSk+KIOw0Kflk5KH5kHTh4YvJ4jssYDW6TfpHvm1eET8+DEJjfN+85Raa20zfxZm/+501kjHTF3Jjpo/t6FMrBofyBLRplHBB7O9XKbeVTabV5CJ6fmYlh0n2UbPM8RMFf6QzpulV1WKN2/WOW3Wf8XVil19LSvpZeSecBeh5L5XPL6Aw7YKn1gXntZDJkz3TwyzkjXzEvIfOkR6T3p+2SOFG6FuIm/aflNPBgky+BFHMEc11BaAmThj+brjksRz+szN3QIaErfRmmKefAMtdrylcki6U7ymcV6aadVHkZ9Jf2Cl3dZbTZhjF4rGAl14BkY/pw1vq2tZ/B64zHBEfSFQHAE98fEjgC2yj+ZlzZ0S1qczOWCIes1sBBd6ZeiPkKIgnQ28Sye2wzsktgtca540bwUNgrvk2VwDEf2UwXq0YojgICZY75+7vlVmhHNZxIMibExOg/hJBpeNDjigvnOKuwcAuwsKEHpbGK3UzgSElgszZjmNs+ac0DgBekvq36vor2wWUcgmjs2CdBP6CvxszKhmVy0SkTTaNgFxDUNo1y2SrrtiebZml212mxanTHWH89Lx6RZVrCe5kDA0J96ozGMQjZQ5vpjrnmzjptuf47AftgRRxBEK6N5jgLfWm1m1sCiMSzG/Cz5Xq8Wszj+TXDdKlvIHVYbYXwnLVvpD+2A8sC2fLu0zPxU/Y7VXx+8b55JIeg+Ny/Dv0djVAA2LXyGMeaJeoKJAOCTYwHllcZdOLg4yKAYDLnJqh+CZ78xjwAgIrL6w4bUWKegtD5nvnPjoPVvgp3Cjg7bte1gjEGpefF/LEm7uDRx0ImbMj9MlvREY0XgPl6cTMvTaGutf/znINU41NBASW22sAeseh+Pwb80P0+Qrlw7LZovCts+UrmI9lulND4QDDGPPNKMhadLVyBE8wMXqSUlJSX/Y/4GjsjM/6uEitwAAAAASUVORK5CYII=>

[image17]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFoAAAAaCAYAAAA38EtuAAADlElEQVR4Xu2YS6hNYRTHlzwizyISg4uBKAy8JpKQSB7JLUUUhYEikhIDSfJIkpBHMvCKMkCEOBiQgcfAROSREmMU8vj/Wvvr7LPds8++55x73LT/9eues/d39v72+tb6r29fs1y5cuXKlStXrlzZ1FHMFofEATFDdC4Z0Q61XNwUfZMn6qDu4rg4JoYkzlWrHuKCWCP6i3HilbgmesfGtSt1FVcj+NxWGm4eHBgpOpSebpWmi1/isOgUHdshfotVYVB702Dx3nyijRBZTXbfEROtuoBPET/FJSsmx2bzQK+PvrcbUX4DRbP4IRaJAdY4n8Om9oj7Yqq552YVi8PvQ5C7ieviixgbBiXEc/F8E8wXiu9NYr75b8L9ue6caEyywvnNZLFBzBJjxNCSES1omTgqXotv4rR5UxkWH9QA9RJbxEMxz1oXcMT4FeZBxrPLVUiTuGue9dzriHn2LzX3d/rIWnHQPOluiGfmFY/oBbfFXPMEnSnemS9KRTXKn7NolHghtidPpGi1+cN+FFvNG2+aWAQSCn8nUEHBdrh3WKhJ5pUeAkkGs1A9o++IfpAp0JX8mQk8NQ8AqzlerBOPzLOgEB2rRaFJXhGjrXxGpgnruGg+pxGJc0mdEs9Fv9ixTeKrlT4LdkKVhEDSgOkLZ6PPfcyTM1OC8oPv0d9ywk7IgngAWIBaqoBrEVS2YyesPtu+BeZZedk88OVEoAvmPSqIQCf9PRlo/Hmv+T0C5yzjdpKAfbDyhs5kCla6ZQp2w+RaKwLMToMdB16I11WjaWKfFf0ThcC8tfTrVhvoIBpqs3kVEuz9VqEKQ8BumXsbK7bbSidPGVKO8ZJiUV6ae1hW0bBodDQhGl8tL0Zh8XnI+GITEI4lbSGpagPN3/j9CC6eXrDSa/0lJsOkgj9TevhvfHXosJ/ESfMdCtCN34hBxWGponlgPXT0Ss0qi3hBYYdA38B+UHhoAs3Wq5wYx1zYUsabWlqgQzUTaHpTPEnY5RCb1Izm5Dbz7DwffU7uocv5M40nvJH9C1F198zLd7HYad5rdtnfzxDErobqDP76WSwRD2LHuAaWBHwOx7kPdvFEPDbvKxwj6eIOkCq6JyRVb3+ut7AjrG2hebbVYkdZ1MV8Ebkve+qWYlaV6uXPiEnRoLKQ6nf/k7CJleZlwRsj/5doMn/7YjvGsTNW9MdKogo2WtHjK8FbWa5cuXLlytXm+gMwJ8GdWd/B+gAAAABJRU5ErkJggg==>

[image18]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC8AAAAZCAYAAAChBHccAAACdElEQVR4Xu2VTYhOURjH/0IRQ6Jk0GSKKIUUzSTNQmFhFprFTJYSCxEWVqaRLCykjJV8JvloshFjqcxClJqV8lGSj5VEWSAf/7/nHu+5z3vPe+duLHR/9et973POfd/nPufc5wA1NTU1/5pZdD89S4/SZXRSbkaa+N4jdEF+uIlT9Af9FXmLzojm7HPjo278L6vofdpD59Dd9Bs9hPIH6KDjdBedRrfSZ3RdPKmAqfQmLLHtbizQTZ/QpX4g5jSsEr3ZtR7gMf1AV4RJBUyh5+hI9j1wnN6j06NYEf2w5K8hf39A48MoKeBJ2I/szK7b6AP6GbYqKTrpe3rYxVXJL3Sti3vm06f0DV3ixvQw5+kGF29CSziPTs6uV9KPsK00M4sVsYn+RHPy22DF2OHiHlX0DGyutmqMVvw2ne3iLdHLd5W+pqvdmCckmUrex4sIBfDbbC8mdv8f9CZfhyX9km5GYyVS6MeLkqySvCr7ELbSWnGhh1ABw3UlltN39AoS7SnjIIqTrJK8GILN16foojdg3asy2ot6cv3gHjcWk0oyFU8R3jGtgFZiENZpStHLeiBT3wNhS1yOYh51gu9oTjIkn+rfHm0T7Xnt/QHYgeS7TyFqZ2prvrUpaSWgMyCgqrSj0XcX0lfIzxHqHGVnhEedSf/3FnYCt+ztgcX0Ob2ERluaSx/BlnJNFNNJ+hW2J4X+4Bgayy3CyZk6eFKo0ur3qv4WN9YSHekv6AnYXrtDP2XxgPr9XdjR3xHFlbTiesE0/wIdo4uiORNBhbgIO9l1wldCb3YP7aMbkd//ZailasvpXn2WtdgUKsp6H6ypqfkP+A0+934CuWRW5gAAAABJRU5ErkJggg==>

[image19]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACkAAAAZCAYAAACsGgdbAAACfElEQVR4Xu2WT4hOURjGH6GI8SdFYhqjKWFhagaRZDFjo6RhIZYKCysLIjUzaRbYCEVKouyU1azG4htTIyxYCDHyJ2UhG0VJZjxP732/79xzz53Pkrq/+jXfd95zv/uec95zzgAVFRX/BXPoJrqP7qCLctFpWEUP0JV0JuyHNtDD2eeQNfQ8vQ57Zm4+XMoCepl+pWdgSR6iT+ljuq7RNc1W+pNOBX6nu8JOZC99QTvpfHqWjtCFYacEbfQ5fU07oths2IB/w36/lC7Yy1/RZ3SQLs/1AFrpG3owaFtMn9BjQVvMDHoRNvCyfqvpZ/qJtkexOkpSSzEdSk6zq76OErhDa7CZTbGCvqc/6MZ8qI6ercEGEk5Cjr9J8hKKSYpbsFnQbKRQfz2XetYJkzyZDzXQw/fobTpBP9J+5DeFkkm9qKzdWUbf0l90WxRzWugYLMndUayOXvAIjaJeAttxKmgVto80lUyzJFUSV2AJHIlijtfkS9igkiiReVHbadiO35LF7iOdTLMkxXr6hd6ls6KY0OxN0qNxoBmqDY3+ePa9LJmy9hDN5imkd69iN2ErpxVMooCOEZ1jS4N2T9ILeQjpZJSkXq6LIIV291rYWVpDseYU1zL3wlZMl0gBnYcfUExSyx0Wsv7qwO2p97DbaDgzvpkcvXQw+9xHrwYxod/TQFUG2li+cjkUvEY3B20a9QNYHfpt4ptpIPsutNE0i/uDthhthFF6A3amakDhmaqVqsE26UPYQJLo2tIRcAGN+3QcxSXspu/oCdjdqzI5B9t4Zfhs+3Wr4yjcwZogj31DyXI7etF22MtVQ/pHI4XqZifdA7sqKyoq/kX+AIkchKN1sDj5AAAAAElFTkSuQmCC>

[image20]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACcAAAAZCAYAAACy0zfoAAACMElEQVR4Xu2VP0hVURzHv5FBoZSUJIKSQyFCfwaJSMhJMAgkxCDKTQhqCoWCgsQhRHRJJTVaCiI3NwcJBwUhHUqJcHApWjK0JYWGtO+33zm+866v+7yKg3A/8OG9e86553zvvecPkJKSsn+ppDejhY4D9BLto8/pDVqY1cLuv0XL6UF6mF6gd9x/cYS20zH6hB515TmppvfoBP1DX2VX/6OAPqNPYQOfoZP0Ez0VtKulv+lG4Cq95ur1gPdh94vj9DEscE4U7jqs42/IHU5tluk4LXJlt2GD6016auhnukA/0k5aFtSX0EfBtWiF9R+LOvmC3OGq6Hc6R0+4siZYuJe+ESxcf3AdRQ/2gB5y13qTd2npZov/EBdOFCPz1tTpAF2HhfTkCyeu0G56lj5E5pPHki+cR8Ea6ArtReYtCIUbpa/pIv1KO7B1TmlxaDz/sHnZTrh62IBLdBg2h0IU7j097a41BWboC2Q/RGK2E86jbaKL/oQF9ihAdHvRAtAKvhwpT0SScOIiXYNtJycjdSGaV1o4bdGKJMSFOw/bMvTr8e21j+lz6hPOYmtYH06/OyYunMo0QFinQAqm/U/7lL8/Gk6fVfc2BmWJ8Z2/ga3IED31D3o1KGuBDToIO0HkEOyI8xyDnSTv3P/EaELrZNDR5Y+cX3SennNt1PFb2CDa0XU2qs2Iq/PoKJuiPa7dBzoNO/L2FL3NSthRJyuyajNoxdbRZtjn1spOSUnZDX8BS2VrjTar9X8AAAAASUVORK5CYII=>

[image21]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAB0AAAAZCAYAAADNAiUZAAAByklEQVR4Xu2UTyilURjGHzFFaEZqWIzcNDXNThGNLCWLIcVClM2o2RArJAslC2ykbKRkYW3DisWVjdizmCkpZSFLCwt/nue+35/z+e7n3u5marpP/RbnPe9533POe94DFFXU/6AKMkw2yRL5Ep0O9I2swPzkr3WuUmSD7JMBUhqZdVRPjskaLNlPckU6XSdYkAvSTKrIIjkkH735z2QW4UY6YBuLqYxskUtS59h12lOEARvIHzISeAA15JyMe+Mu0hNOZzY2R8odW0bfyT1Jw5x89ZJnWCBJyR5IS+ABlJBdhGs1p9vwVUsmnXEgOSpYGvGkL2TGG68jnlTaIbekCXZrU+QXzG+VNIauoXIl1dVLCp6U9K39E6xUHxxbRKqZandCqh27aqqkCqrNpBEPLmVLmpdUhzvS7o1TsIflJ60kR8gevOCkehBqk7/kmuyR34jWNCl4kr0gKan7enXd2YIr6Q2SP5NETcBq6r80nXwb0T7tI08INyGp/w48Yr2YS9rtI/nhjdtgbaBEvtRzZ2TBsX2FnXLIseUtBdf3NkbmYYFGYSd21Qr7HqfJIOw3WsY7rZFL6iv1ZjfstSZJc/Lph32NRRX1b/QKrudacRUk6IYAAAAASUVORK5CYII=>

[image22]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAbCAYAAABIpm7EAAAAtElEQVR4XmNgGAUjD7ACsTgQS+LAAgilDAwGQPwIiP/jwXuAmBukWAWIDwCxBxArAvEKIDYDYgcgnsWAsIEHpBgESNYQAcTKULYmEM8HYg4g9gTiSpgiXCAHiFuh7CogLkeSwwD8QHwIiF2g/IUMBDSA/HALiKWhfJCGOQhpVACKg1VAvAaIWaBiIA3XGSBxgwF0gfgdAyQAYADkn5dArI4kBgeMQCwIxMxIYiBbQf4aBSQDAEtwHredrVsJAAAAAElFTkSuQmCC>

[image23]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHIAAAAZCAYAAADt7nrkAAAEmElEQVR4Xu2ZW6hWRRTHl1iQdLELZFFBRhekRLMLFCEREfmQiFmp+SREIgqmoBVEUfRQZJQVRi+pEfZiPpTYRVTspctLRTeIkKTLUwlRQYHV/3dmr858c2b2t/f3+UGH9h/+nG/PzJo9a/571qyZY9ahQ4cOHTp06PDfwSni2eLUtCICdaemhZMNJ4qXi0vEWyw4PaWnxeTFYvE98UHxdfGc3uoxIOL94vq0og0uFJemhREuE58UXxKXi9N6q8dAGXW0oS02TYDdRvEncYsFIe8W3xG/Fm+ywQQ9XbzDBrONwQTfaWGOcujn9wXix+IN1fMK8WfxEfES8VzxVgv+vm1h5bbCLHG1uF88Jm7vrf4Xt4tfiHMtvOQx8V1xetSG35RRRxvaYoNtHbDbKx4Vr0/qEACB/6r+thWECcKn1hNjQZzbxGfF78XfxKt6WgQ08XuB+K14fvV8kfi0ONPGP9pFFlbqlVWbVkBIOmACv7O8kHxNrApe5jhD/EhcE5Vtqsqoc2DzpTgjKkuxSvxbfN7yQvm7/hCvS+r6YVghEeBG8WErC9nEb9ogJOMBuXHda0OGVEDHvCgnJINKnWDCXxUPWhiMT3Zqf434q7gwKXdge9CCkOwhJdAvbR5PK/ogN2GDACHSOQBN/ca3WEhW5oviSdUzecErNvw4a4Vkz8o5QdsfLYQJVjb7W2qPDbYlAfy9iEQYK8GFTPvvh1EL2dRv9syvLAgM2A/vq36z8rfZgCE1RZ2QlOWciMt94Kl9qdxxsrjPgkhx6I4xxcLqpw0T2gajFrLkX1qODxvEQ+JK8U0b3y8Jp0OHVEdJSA99OSdiIVlNuRWTOpQD+yy2rPwcPHyRDF2R1Dn4IF4TjyT8QfzTwv6f1j06ZtkMJSHb+n2xBZvTqmdWIeP2D81PBsssHMVaoySkr5icE7GQJAVtHIrBWfEzm5gwOLyPZyyfDNVh1CtyGL8ZEyJ6SL1W/KB6vkdcZ+39LQoJYsFK5aWBl8pT3CX+YvmslElkZfE1t8WohSz5VyqPEYfUE8SdNr6nsm+SDJ1XPTdGnZB0nnOCtoQsYj0JD4lPau8OcZuRw5niPAth5GWbuAciwAELRxTacEbD6aYYtZCD+p2GVI4p31iv/2tt4vv6ok5IUmguC26Oykib91Tkt++l/uzAhj0qto2BA89ZsGHQuyyEcwdZ4RsWDt1M2mZrF25GLeQgfqchFfj8x0KSO+QiVC28I7LDdKLOEj+0cJ3kIMyxGuMrPa6dSCJmVs/0w23H+9Z7AxQD0bjN2GFhRbJHMBYHicEnFq6+9ooPRHVNcDyF/N3Gjw8x2vpNOOXwH4NLcu5hXUj6eMrCh9wIfDEIwopj04YcZD8VZ0ftrhYPW7gm40qJxOQJ682s+L3VQijktghnPrcQDutAturvZp+cE9URXrwOklzkQIh+yyZmpnVZ60NjlmV4JsydaDwG+uR6zdHGb1bhNsvfUyPibgv9sVDYI3PthgaO8R8JBsu1XQ58SZdaEHu+DZhCT0I08ZvQ+4KVkzZEY3GwMrm7zX0IHTp06NChQ4cO/y/8A22ONKOaYqZtAAAAAElFTkSuQmCC>

[image24]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJ8AAAAZCAYAAAAv8vwlAAAFEUlEQVR4Xu2Za6hmUxjH/0LRGLeZTAadkzQSZXJNuX1AKBIyRNKg8UEJIUQzofBByAfJJUlyK1/ILR3NNIQSkSI1I5cklJAhl+fXs9fs9a6z1n73mX06p2PWr/69533etfde+1nPWut51pEqlUqlUqlUKpVKpVL5P7Ov6TbTI6Z1poNGf+5kd9M18mu5B/eqjHKw6V65j65XPx/R5kXTmc3fqXZrmy5cjjG9YTrBdLjpZdO/ciftELXLMWH6yHSlaRfTGabP5fesOOfJgwjf4uMPTX+azo0bZTjS9Jt8LHJa0zZdmOxqesm02rRjY1tiek/+4jigxE6mR00vNH8H7jK9Kr/39s4y03rTKWonMrvKt6YvTAc0thxnmT6Qr5axpkxvmvbY2nKBwvK92fSLfGYGbpHPrusiW8qBpu9MNyV2ZvS4wN1eCKvXl/JABILwabl/2SlKXCsP2hgC7nnToYl9QbKz6QHTaxrNQwgonJMGVgyO+UfT2zBjufbixB4gV9nfdJrpEHkfjjKdo3YlYIBWmM5v2oRVmc99TIfJB47VlUHlmSfK7wWL5PdH87lC8Gy23Cc0mqM9KfcR/S5xhGnv6Ds+uUe+jZcY6h9+pz1p08nN90n52DCR4t2Re9KGdGvWYAtlK/1bfvMSIchKwZfaA7zIN/I2bCNPyQP1VvkqcUVjZ9W9qmn7kLxfe5qek/fta/lg3GG60LRRvh1dJL8nNgb5B42u6vPNXqb3Td/LC5G+nG16WG0A5Rjqn0nT2/KxeVf+PMbhUvnqTZpFccl4cP3r8pyfxWRWOFYeBARA14uWVsdxwQd0Fud8pnY7WizPj7bIE/MAOSSpQbwyh7Tg6sjGdo8N54d+l1KDHFxDkfWzvCC4X17J56DPOH9bWCUPjhs1vqALsNK8ZTou/aHAEP+EtIBd7fTIHu5JMId+H2/6S90reG9YgpkdzAyW5i6YEbkg6xN8Idd8MLKxLU3JA5BADHCfNPiw/SjfkgPhuXEVGZ7T1ZcA1SPbIxMD3S6f/bljJ7a1C1JjDybkE26tuid2CoH+iWlp+kOBof5hRfxUo8+jze+moyNbyGkHBx/OYJm9T/0q1VKQlewxuZcOwYfi/KgUfKktPDd2RO45OdgK79b092al+dh0qtrZThvO7AjAmcDE5hiLbSvkTn3geZwepKcKXQz1D8E3penjkBaSsxJ8IfBuVusYZg0JaYmw5KYdz82wlNxLz2fw8a7kNTkmTRvk53OPyVeuPmegMSHwVqm9jgJg5dYWZegbqxgB0Zeh/pmz4MMZOJPSPnYo21AcQDhwudo2+5k2aXTrBK7DWfGSn5J76fkMPlIM8qoSTEgcTfW9QjMLPCY2+WM6Ge9Uu4Vx/0nlK0eqVt6L3LcvQ/0zJ8GHEy+T7+UUAF9F+km+ugEDQ1WzRW3Sy7Ukn+RFoVzH0SS0z6h7iwgFB0lsoCv40mDmOq6Pq6wu56YTZK7AH2vlfot9S983yRN+uFze95zfmMzj0piUIf5hXCk4crl3Kfi26b8t4eF0KhVVUHAOwfCK/F9nE40NCDrsz8pn6OPyLaqr9Ob4hGoyPIf/plwiD/Zg429s70Q2rrmhaZ/aeD4VJDY++Y7916gt13EGNpeEwUl9izhuIdcEAuIP5SvgUmGXg/cb4p+T5EcqwcbvuXGgLkDxOHL4Pa5InXXiLYnPmSTTlfEwoBQ8pWOfSqVSqVQqlUqlUqnE/AdjrHbBjlSVoAAAAABJRU5ErkJggg==>

[image25]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADwAAAAZCAYAAABtnU33AAACZElEQVR4Xu2WvWtUQRTFj6igaFBQEkQlKWwsBEUiRFJYBBFECIpEMAgifmCjRoKYVtJG0BQWgliIIfoHBAtdsTCVoJhGsFDELrFREcWPc3JnyLznzNstNsWDOfBjd+/eN/fe+bjzgKysrKyseqmHnCgbnY6T/WQ9WUE6yTDZHTrVQTvJRfKU/Cb3i38vahWZJn9LPCIbAr9aSAUPwlbvE+IFS3fJW/KRPCaHycqCR820hXxAuuDbZG/ZWGctR8EbSTc5QraSNeSA+73J+WiXaFztsh5Yf5BWky6yD/aMfut/+cnf7y6No/Hko/FbVrOCJ8lN8gq29V+SPQWP/3WFfIGd93FyD9YUb5EFcoxMkXNklHwjlxeftOKew56dJXfICDlF3sOO2CVYXhrzCXlNtqFFNStYyV7H0syqQytprUCVesl3MkPWOpuS0qR9JjucTY1RvaEBuwkkrfYD8occcjZpDDYRN5yP1E9+wVa7JTUruAPFJuWTfghLNiVtP63c+cDmY6kYn7Ck2A0sFextc2RzYLsGm0RNppeP07aCy/L+2l46aynFEknFShVctqlgjRn2lFicSqWSkE7DttWFwOb9hb6nFEskFStWXMy27AUrgM5MWLDf0g0UkykrlkgqVqy4mK2tBZfPldQH64a6GryGyA9Yp62Sb1pHA1tVweF5VR7K5wWsh3hVFRz2iqgGYCul10r/yviVvCG7nI8CXyXPyBnYtTIPeyUtT04oXWPhuHoVHYWN723vyEn3GcY/C+sPoU03g65Db/tJJhz6HsZZhzZoO+ziP4gavkNnZWVl1Ur/AHQ9pNK7jvBVAAAAAElFTkSuQmCC>

[image26]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAH0AAAAaCAYAAACacVPHAAAEhElEQVR4Xu2YachtUxjH/zJkyhwJeckQGT4IyZgQhQ+umRAfKJQhGULkizl8IfMQSTJ0jZHekIRMZShfkCEKJRQy/H89Z9+9zrpnn73Ofb33XG/rV//uPWutd++11rOeYW2pUqlUKpVKpVKpVJYHK1nnWWflHR1sal1h3WldbW0z3D1VtrQetTbOO8awvXW9Yj2LrJWHuxcme1q/WhfnHSPYw3rJ2tfa1XrW+se6UHF4psmq1n3WF4qD2QfjL7fetnaztrYWq/zw/29Z13pFYbg+o69hPWWdrtYbNrTeUhwaNm6aHGP9qXKjY9zPrJnB78MU+/BAM2BFYL2BxoG3rZY3dsDYC6wbVObpbCQb+rPCyxsuU2wWz5oWM4rw/IzKjL6FwuC3JW04AJ5P5JsYHki4YxL82zeBPja33lBsLPrEOlCjwyljT84bO2BxN1p7qczohMNbrRc1vCb+riRSzBfM6yZF6sFLS4x+vGLOJ1mrK8avPTSiEF5+nfW54uUY/T3ra2vbdthEEFLvV4QeQiqG3sV603pCYeQG+i6yjkvauuBUM78ZRVguMfooVrEet/6yDhjuWm5QfBFlWH+p0fFwjH6N9ZB1tvW+wn7YsRg2+xINV3/8f32N9soSKC5OzRsVzz3B+sGaVXvAHlMYdBzM5XxFDoS5GL0pAnl/32bRT+T7yfrDusVaZ2hEyyYKb+yDav0utWsuNTrjMPqsWg/HMb9VzLGYc6wjFMUNL+3LvyWwmM3yxoS1FO8kr2K8kusGYZBw2BhpWY3O3F5WeArz6ONMRXVNdEJXKiLWqCvfTtaxeWMG8yc9pTl4UqMzpwaMP2t9ZG2UtI9lb+sXtbn3SUW+mCt45qHWC4pNPlER9kfBgds/b0xgYXeorVhhWYzOhvOcm9U9lxSi3bVaeiz1xIfWwWqjIWO4N2P4cRypNqw3lBr9boWNcJiGxujFNxFO7u3WBnnHfwDh5h3rDEXh8bz1qUYXc0yWcV3srNjkLxN9r9gADiy/D1oyejSNwS9VG1l2sA5ZMmJp6D8lbxwwY72uSE/3KApV1pyvLYcDl64DkTZYyzeKjzRdEYjDMmejEyaOyhsztrIeUeQq7roPKnL2OMhtnPo8X+5ovWs9rbg+cbJ5P5s3KlyOo8vTeSc5M303hsAg1ASpUfrWz+YThbrg8DCPo63t1G/wLro8nX1M30+E+V3hRA0Th3cWzclPJ0uYojqkQKD9XIU3fKzIQx+ov1jBoIfnjQN4Pt6D1/9tvao4DJOyu/Wboi5IIe/jDVcNfrOG0xRjv9Kwh/1o7TMYNy2Y38OKuaW3Gj6zfjdox/GAvVusCPPcQGDiQo6ihrDL4puNoLLGKEyGB/PQpphpqvqSwmu+4Ps093+uW00dQqhvwjvf4wmXiwa/8R68qBmbis3qi1rzCV/X2PtmPsy7Ce8cAByMeii92ZBycMB7FSmRtEeKzqPqWNIQhUfn+QTjY/A0pFSmCwbeT3NPK52QJ17T8CfMygIHYz+n/o8nlQUE4X/NvLFSqVQqlcoKw7/Cbebgdu6JmAAAAABJRU5ErkJggg==>

[image27]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIgAAAAWCAYAAAAb1tRhAAADTklEQVR4Xu2ZW6hMURjH/0IRIuSS20lS3kjI5cGDW7kklwgpd4miQ1IevHgmlxcRHuQaT8qbkcKTJ5cSiVyK8IJQLv//+WbNfHvPnnHmmBky61f/Zs9aa/bsM9+3vss6QCQSiUQikUikvQymWqme6YlI/ehOraCOUfupocnpNpZSU2CG6UQNoFZRY/2iBrCc+k7NSE9E6sMg6gZ1EOYY86in1DS3pgt1gfqZ0kWqt1tXb/Qcl2DffSg1F6kD+sGPUw+pgW5cUeQOksbXunvUc5iR5lKd3XwjGEndpb6i9JkjdWAM9Y7KIZnT51M/kAzjh6nx7v3fYCXMeeWger45yelIrZHBPyHbQRTGd7uxjjhIH2oE7H5DqG7U9Pz7fvk1ikK670KqBVbfZKFod4qaDHMUPd8RlF8fqQG/cxCllYCMcQAW4l9Qt6lxbj6LHdQH2L2080/CikzVD++pxdQ5aiO1C/Ys29s+WYrSy2VY2tP1a8Q0U3f0Y6vWuEn1cuMypox62o3JuHtQrDvUwcjIEwsrsplAfaauwboloWJYTvaKGpUfCwVoDtktrKLGvvx1WFttmlG0WUa9hHVC55HdsYke1Ib0YDOiXfyWmpR/3wLbmWkHkQP5ojQY+SzMYOUIUWqTG9NZxjPqDJIpQt+XQ6mD+PQS6EiamUldpUbD2vR1sL/V3zegyLQ1PdiM6MdVa/sYZrQrMGOma5A0wchPUDnMBwdR2gqEz3oHFOUcRCklRBx1UdIb2DO2N83IyRQZ02sVwRRF16K4AfS6k5odFkWSyEF8F7Mm/35zYUXRyJKuy1ELB/HpJVBtmukPq3Oy6As753lEnYDVWUeprn5Rs7INVoOo2xCKKKo3/DmIIol2q3eQkGJyKDWo508dRJ2PaoWsNFBNmpGxKzmyPq/UswT2zI0+4/lnkVF08BQMoKJTHcKCwgqbkxH8jlKx9wVWw1QiFKmL3FglB7kP2+2BqbADuuFuLBC7mQYgR3hAraf2wqLCaiR3pK5bqeuwwk5tqg7YtqTWpVFbrG5Bu1zS0bzC/Ec3prCuSKDXMKZ57WQ5RhiTfCpRNPvm5vQ9t2DFZ6TGaPcpBcyCtXflGAY70NK6Rv4PJhKJRCKRyP/DL9/Vvgj6dtprAAAAAElFTkSuQmCC>

[image28]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHAAAAAWCAYAAAAYTRgMAAACJElEQVR4Xu2YwUsVURTGP0mhSIxIE1GRJBRDUNCNghuREEIRkooEt26kRUJhqyhc2NJN0CZcuHAThAiSLiRBQRcSlIsKAgnEP6Cl5fdxRt99lxl7Kwfh/OAHzrl3ePA+z50zD3Acx3Ecx7ngXKGP6Tv6ht6hZUU7jFbYuvZpv+5zcuYa/UDHaR3toJ/pFIpDvE/3aCetpK/pKux+J0cm6Yuo1k536a3kupH+oGOnO4DrdAd2v5Mj83QWxd2mTlSA6kah4P7QrtMdtn+BrsM60smJGfqPztGrSe0hXUYhGK3FAQqFf0Cbo7pzjjTR77AQf8IC3UjqJyiorADT6s4500b3YSFKBVOVrKkL15EeVKkBtsAGo7/0K+1H+pQrHsCOcKdEGmAdNwGbRBWIQtykN2DH6lpSj4MqJcCbsGn1Hmzw6aNb9Bm9FOwTCvUJrY7qTgZ6j1uiz4OaAv0IC/FkwswKKqseoufpYFTT576l71HodNFLXyG7O50ITZl6/ukIDdEXvAILSOi5mBaU1n/DQs/iKa2Ni7DuU7cd0kXYP41eS8Jnr/MfFIheztOmSL0bavoUw/SIDhSWcRk2qUr9nUU9LY+LATqmh+hdFKZgp0Q0oHyi0yg+tmpgg0tPcq0veZu+TK7FbVj3PQpqTg4oiC+wIPXCrs77BhtowlC76S/Y8DEKO+70A0BFsMfJCT2PdJwqmLOOMtW1PgL7ec1xHMdxLiLHmv5ecrJX6/AAAAAASUVORK5CYII=>

[image29]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAH8AAAAWCAYAAADpRkOBAAADN0lEQVR4Xu2YS6hNURjH/0IR5XFF8kwiI8oroe7Aa0JCERORx+AOcD2i1JUMGBBRUkJSXslEEYMzkigjj2Ig8igDSijK4//3reWsvc/ex93n3nPdTutXv87ea629zz7nW+vb395AJBKJRCKRSPdlOG2l/dMdkdrQH7qXnqL76Phk918m0kOwcatp32R3l7CK/qDz0h2R4sygt+lcOpneoL9gq6tHMG45fUKnwFbdfthxA4Ix9aYXvQq7vmOpvkhBtHKv03W0p2trovfpFzrVtY2iz+katy8G0Qe0JWirN+PoQ/qNPqXDkt2RIijdv6SfYKveswe2ura5fQU9nAxCWeECLaHr7r+6jgOw1f+TLkp2R4rQmx6lt2ATwbMLFnx9CqXYdPDFOfoOtiKzGEjH0MV0BO1Dm92+MoxQxtF5l9KxSN5qQpTyz9JZsEmg6zuO/PGRGvD3VRVVza5NQc4Lfla7Zyv9CAuUVuwZWMGmyfQBVkdcpBvpDti5tvw5shJNsGuwGkPbmnQx9XcyM2FBUEWvzKCUXnJt6SD/K/hiOv1Kb6L8dDCSvqZvUX6y8JOuhOzbiFZ7m9v2Y4umfmWJlfQNbHJfgl1LFv3ohnRjI6NVdYeeh/14oU+1ZQW5PcFXn8ZsCtp8raGaIUzbOl8JlcEPU76nltQ/H/Y0M4EOpeth2SM8r0cZpSuL2f+KVvlJehiVz+95Qc5rD/HB133e44Ov40Pygq807zPFK+d7WPDbm/o1gXTrSY9V5rmH5BOPPrfThX5QI+MDvxvlP2ASXeC29adlBVnBUlDyUqfojOCHKd9TNPUPgdUVWQyml+kzehr2OHkC9r80NEqZrbDiLEyfStPL3PYSVL5VU+WuFCq1nUdHg69z696clZqLpH4FMnyiSaPjdTtYAbtmvwgaFv3gtbCCTCvYp1SpanyOG9cEe/HT5vaF0qWOUfVeDV/w+YkkqgX/MWyVembTR3R00OaJVX8H8EHQ6kmbfn6fRl/QnbDVobd7B1E9NR6BZQx/ziuw1Ps5aFOq1QrWp29Tv75DQQ+vKUzvm+n3oE/fcxdWyEXqgCp/1QF6IaNXvpFIJBKJRLo/vwGNRb814MXqSAAAAABJRU5ErkJggg==>

[image30]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEwAAAAWCAYAAABqgnq6AAAAn0lEQVR4Xu3UMQ4BQRhA4RFUOhEiUYoLqBxAXECiJzolR3AEpQPQu4NKK9E7hsSbGDHmCvu+5GWTP38zm90JQZIkSZKU1GhBT3rRiQZ/Gz8tWpfDqpnShUbUpRXdaZIvJT3alMMqadA+fF5EbkhXWlI9zeJzS7PvUhV1aFcOkzad6UFHutGBmvlS1cTD98thJt5v8Ved0zj8vjZJkqTMGyv/Dj7e8htfAAAAAElFTkSuQmCC>

[image31]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAG4AAAAXCAYAAADqdnryAAACsklEQVR4Xu2ZT4hNcRTHj1DkX6KRKH9CKbKwmIw/TZJIrISslCKFBTVqNhOalZSyIIWykYgslCILilBYSJIFElGyYSH58/123sm5v/vedd/T1ZvX+dSnee9377zX/M4933veG5EgCIIgCKpgLNwPp6YHgnLMhFvhdDgcjoKL4I7a46pYAr/BnemBoBw9ohv4y/kVrvMnVcCg6Htdk2ovkI5lMXwGn8Mn8KBUH18T4S34CX6GC7KHgzKwcMfTxYpZBk/DI6Jdtzt7OCjDvxZuDFwKRybr40TvmfU4DLeIFvA7vA5HZ84I/goLdwWegy/hGzgg5TfyAHwrOtwYHDwYgb1uzWBMXoazao8fSsRlS7Bw9+Gc2vNJ8AE8JfkuShkBL8Gbop1n7JN8MQ2LSf4usSGl2bicB2/Dn/ApXAmHZc74wyap/r7932Fx/KaTftFJk51TxDT4SnTzDStmo2nRYtJoJS674A3RyZdduxzeg32Sj2cWcy+cnKx3JIw/dgE7p4hV8Adc69bqFdPgJrObP4pGMn0n+l7NxOVmuCZZY9FPwLNwvFvnx51D0rgbhySMRd5jGDW8ig0rHH8WwePv4Wy3xg5it/piGmlMGs3GJS+oKemiaLexuz7AC/Cq6N83w5/UCTD3X0u+cIxKbuQGt5bCGGQc3hGdIA1fzG1wtTt2TLIxaTQbl+zqtPgeXpDrRd87vQ10BPzjT8JutzZB9KbPgYOPG2GRyCuaEUh4Zb8QLSY7gq/N88hc+Eg0ulJiumwBbjY3mh+Gt8PH8K7Unwg9dn9jp5yHR+FFuEu0487APaJXPCPLf6XGODP4Ol+S4/wmZ6E7J2gAJ8sVcCOcL/nJrB4WiewkxizjyQYAfvPvnwdtgt3f0s9vQZtTNPIHbQz/X8eRuzdZD4YAReN4UCG/Af5mg8KMTbGVAAAAAElFTkSuQmCC>

[image32]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADkAAAAXCAYAAACxvufDAAAAq0lEQVR4Xu3VIQpCQRSF4RExiGARg8EgCDarWTfwqkuw2UyuQKvVanEBxhcsguAaXIr/IIL3JpMwl/PDVzxpeL55KSmllFJ/q4OW/zFKE5xxQt9tRdfADDUOGNq57JpY4Io9enYuu3y4Cjds0bVz2eWLZIkH1ul9uYRrjidWaNspVt9Pc5OC/VV9n/fyngJeOj7/+RjYOVb5sFNccMTIzvHKB9xh7AellPq1FwsdEUjUqFP7AAAAAElFTkSuQmCC>

[image33]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFoAAAAZCAYAAACxZDnAAAAEaklEQVR4Xu2YW8hmYxTHl1COOQyGqBmHSKhpGDHkSiKRjJARbhySi8k0xGjIJHEhYxzKMRcuHCIXKMSEmjFKEqOUixEpwg2TQw7/36y9etd+3ne/e7/v933py/7Xv3e+9az97Of5P+tZa+0x69GjR48ePeY3dhH3Lo3zFbuKh4h7lAMFuvrNJk4U7zYXfNawWLy8NFZgk+eLj1a8RNyz5uHAdoX4uHi/eFx9eAgPi/9UvKAYy+jqB/YTN4rrxN2LsUmxVjy3NE6D48UbxXfEv8Rn68M7wWJZ+J3i0eK14q/iZ+Ki5McG3xLXi/uIS8Rt4orkMwrLxB3WLmBXv5PN17ddPKwYO898XV3Afp4WDyoHpgFCXyQuF7+x0UJzom+LhyfblebR9aS4W2W7VfxIPCCchJXiF+LCZCsRwnQVsM2PwCAY2Fd55R+y9ucDZ4t3lcaZgpMnAkYJjYAhauAI84P5ylxExEXk8nmi8BfxwsKe0VXArn5NWCButW7Pc0CkvtPLgZlinNCniJ+I1yVb+Mf15Gb8aMPPhzj3FPaMUsD9zecMRvHLflzrc6p/I2AgCiZFjDQRdYTfB8wD5irzeXmujPgAwfOM+Xsy6ECYd7V4lnkgHVzzaME4oUfhTPFP8RVzIUKE8vkme0Yp9H02KHzUAcaz36fiY+YFmQ1zwDeZi8YhPSX+YYMgYH1rxDfN5+SXYo2tqYOhKaB2ZRBMH4inmc/LgX1tg/V1wiRCkwM57Z/FUysbIrGJ8vlphL5MfMM8PWWEHweRI/Fi8Terp6fbbbgYxhrbUgc15xHzW5Fxs/ic1d9N6zdnQq8QvzMvFgGu00yFJjqvMfcd9ZEQftSMjKgXL1m9ME8r9FHiEzYc7debd2YbzQOMzop1TtRCdhWaF3xsnpsymgRtsmeED4f3u3nBWlDzcDQJHWvPHc9MhEZQuqUS5OsXbZDWILdr1oVGZHLUMdXfRA9tHnmRKECo8vkQh6vchPCh/z7DPCU9aMOFqk3o98V9K1sXoZeKBw6Gd4KiSXd1ZGEPsKbF4tXiu+Lf4g3ZoQ1tQi8yv5r8BmjkKSpsjmu0SXzN6leO9EJhymmmRAiIAGzkFvNCW7aETULHIfP1GIfTRWhSAHNm8PcGGz5ksMbqayKSX7BmzUYihC6TPThUfE/8ybzKBr83f1HkRaIbe0QD8xClW2y4TcrIQgMOjuj80uoHG34U4riuvOM28QfxhMoGRgkdnRJpgTUjaBm54z65mZP95ndzuOXBjwSRRiEhyUfe4QODFuqkyoeJcl7KzP0xC6Dt4krxVYbIn9v4T156WyKeuVjD8+bFNr8DQQBC05pdKr5ufps2ma81agY99Gar7yVuU6zvW/FlcZXVg4pg4BAXJlsGEf2heeDw7lfNA3NcEM0ZWPix5j0uDf1EhWICxIcJRbO8gW2gpsASRPwdpTFhL/P3sicOg3TZYwrca3Pwyd2jDiKUtPGfpIH/EyiA9M895hh0IvxfRo/5in8BmiIKB/KbmxkAAAAASUVORK5CYII=>

[image34]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANAAAAAZCAYAAABAQ6AIAAAIHUlEQVR4Xu2aaaxdUxSAl5jnoShB9Ikhghhr5o8hxBBRM1GJKBGJKUWNRaRBIqiqGNqQNMYQP8ySPjQoPwxRpIghSpBGSIkSw/qsu3L3Weece8979773TjlfsnLv3Xefc/dea69h73NFGhoaGhoaGhoaGhoaGhqyrKSydmxsWCFYVWW12PhfZGWVTVXWiF8EqvbrJzur3CDmSA15qtqkar9+cq7KEbGx30xQOU1lS7FJMsFdVaa03qfsoHKLyr1i16yZ/fpfaOM7+tCXazpxl8rfLTkmfJdStR+srzJT5VqxKNQLV8koGKFHUp3fJGbLFJx/H5U7Ve5WOUrM1pH1VC4Uu881Kptnv85R1SZV+0G/bMd95qqMj1/0m/1Vlkt7gsgvYkpOmaTyocpuKuuo3KjykthAHd7Txnf0oS/XcG0nJqr8Kt2VW7XfnmJz+FLyi+BIsXFVgfnMUdk4flEjdlR5V2WamOOcqPKWWLQHnOcylVdUBlTGqcwTc5J0gW6t8p7KOWKBEz0tVtk76VNEVZtU7dcv2+2nMiM2jgQMmEX+sZghrpf8wLdS+UTl9KRtQ5W3VS5I2i5vtfGdwzUfSedI4Eqrqtxu/VgYLITjJF96EYW7Xe8cqjI9NtYInOQDMefxvdrLYjpCV8DrdyoHtj7DNmIL1DPrKir3qzzReu+QzZ6X4krDqWqTqv36ZbubJTvnEYOJkTI7gROkRgEmRyQbFMs27lAPJn2AyLNM5djQnlJVuVX7lUH0JTpXuZ75UYISyeoKAWupWBZyDlG5QtqLHieI0XxdldfEShzmiUN9K3a/lOMlb/dIVZtU7VfGUGxHsGZuaXU0YlRxIDy/SJE4C4rHABgRY0YHcsVhyDKicjcQM7iL78XSfijn8NZ7lOv4ZpXNPynfFxKvt4mVqGeK3ZfrYpRzyoxAlOe+l6ocLBYgNsn0GB0Y15tiQYt5IMw73dugt2ck70AEvEFpVwtk2r8k70DoFn2llUekjrYjs7J3jVBJTRY7XNhFLEOlGXdYMLGnVB5S+VTlK5XrJJu2cYoyB/J2V1CZA8X2lGgE0q/vxyhR/He93/sqs1VOEFvIOC6lJArFgA+o/C7thYMRp6q8KHZPXtkD0BYPSpxTVM4PbQSJBSr7it0XY6KvqJfRwAMWTjRLbMHMVFkk7X2CO0qZA3m7O0qZA8X2lLrZDodAHzhhCmXhw2J7PYTDlPliuugJJrZQZdvW53FiqdI3ma7sbg7kyo6OMhwHOlnlOcmfJnk/jJRGH0qN3yRbJl4p+YXjY/TfKaPMCJeIla3pb3PEHfUS2UzlUZU/VZaonCrFp2BAVNw9NhbguiBzMH9gXOiGPSe6Y+7oIOohOhAOUuQow3GgsbbdgNh+Lk0Avjd0PQEHQzhyzw6Ek8QHhUxguVj9X7QxdVIHIuX26kBEpLPE+sYxgfeLBsVYX0t2E0yf4RqBkvQ+yUc4Uj9OMFPsdArlM870NCuCIR8Ri4AbiT0iIONjvNTIDpmP7NIN18UiyZ4S+hwZ63iVzySvh+hABIYiRxmKA9XFdpSbzD3FS1m2G1QV26msLrYXTJ25b3hEQrGQOkpK2l7mKGXtKd6HCeK4ZMBxmR5GmRE80qYngL0YAQMU1f3U7o9Lu0RBiKidHIiMcnZoI/twtPyCZCM1VQDOWeRYERzxZ2kf4jg+R/QdHcWJ7WWOUtaeUifb4SgEPgJghLKWctvt9pNY0O8JJsrAqVX9uQG4A/lkOQAocyCiB4vAT3Kio7jiyGpleB+eHx2g8qPK7ZKPDt2MwMkSUQWqGGEPsayQwuKlBBgI7Q5jmiC2GZ0vVkKdl3YIkFFY7BHuc7TYEfPTYiUejwr2Sjt1wLPLoJQ7EBGdyB714A7k+sLJ/5C8Xv1eaekTqZPtKLlnSfnBAIEO/XqJ+IPKTpkeQ8QHHx2IH2CwXpfySunCaY3jaRHhvRvFPztcw6YwvTbiykU5KJ7ojEHj0XeZEdx5eeLthqtiBKJ9DAp8vkPyCwCmSnZMGOQxyQeNFPTaKaNQ7hSdSHWDRcKmOI3c4HP0MgY9LJVsWUjJt0jsdBW2UPki+exwj3htpE62i/ZxWJtzxebpkO2/kc4ZrSsY4R6xv3k4lCmviu17/AgXw5Kap7c+AwMg+xBhnTPE0uRA6zMKITJxUhSPg1NSIwCRiIi0WOzExPF+KMPLJn5jmuSjSZERPNJSnjF3HMXH6nCaxTFoEdwTh0l/G8PHRTFaHCY2b19IjCc9RIAiOx2k8r20n3EV2cmDA05aFtGhLrZj3NybzBzBgagWWJ8O/d6QvBMOGSbJhG8Vq9XfUXld8qcopL7PxSIMR5BEvlj/83622GB5koxRiHSd/n7B+T4ZiuhClqOUmdT67IKygMlyjHmSyrNiJ4WDYkejE1t9iPgoxq9dJu3s5+NbovKkykWSzTSdjABEuIViC43fpvSaJ52Dw0jCfK4Ws8sUsaiMs8QykBLM+0wW++cJm+k4d3SK/tkb8BemBZJfByl1sh3BgAffaZuDA2ErkgCv/DY2jDoYNgyOh4I4BumaTW4RXm7gHDyUKoIBbS92L+6ZOlg/YYwonOw4VCXwvAGJEOVYkGWsJfa7zAknS/ceYwm2wCbYBhsVgZ7IEp1KRebGQsd2vJatg14ZCdthN+xXBL/hesFm2G6k1uX/mhlS77/uNBTDno6MOVaVQIOU/3Wnof6wZ2Xv2jCGYAQ/uWpYcaA8498gHGE3jCGc7nQ6rm2oJ+xtLpbOjwoaGhrqxj/6+UBN3RVU3gAAAABJRU5ErkJggg==>

[image35]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADkAAAAZCAYAAACLtIazAAAC4UlEQVR4Xu2WTaiPQRTGH6GIkoiulI9sbvlY0JWibkhKLHwUsRALFjZYiFJ0kxRCQihJQojCRSxuspCdhY2yIJENJRTy8Tz3vOOdd/7vx1C6FvOrpzt3Zt75n3PmzJkBEolEIvFvaaN2Uiep3dSk4nA046iL1Kigvz+1iDpGHaEWUAMLM4rMpz5SPz29oqZ4c6ZR77xxtdVXSgd1j5oDm3QL9tFWqp83rwkZfYZ6AQuaYyh1mdoEc34G9Zy6TQ3z5pWxBmbLeZTbMpzqoVahfLyXwdR1ah0s2mIE9Zj6RE3P+mJYQX1Dq5PalR/UcWpA1rcHZvwGN6mCCbAdlNQOUd8danQ44CNjZNQHFLd6B8yILV5fHeNhqX4TrU52Ut+pa9SgrC92fe3OUdjclcGYUF9X2BmiFDtM3UXRsG2whfW3Ca1xAJb2Z9HqpAxVdjgHlT2KfmymLIRlgo6RW0OofYma5fVFo5S6Aot+Z3GolGWwHZEzZU766EishzmoM1p5jjxGUk+p99Rkr1/tq7Az/8fMhBmh9KurgELV9BTyAlLn5EbqJfUWVsmHFIdr2QXLLAXGobb/fzQy9j51Ds1GKAD7YUFx1DnpULoqU1Rh24OxKpSSX6hHMBulG4j//jcy+gR1EGZIE0uQp6kjxkmxFLYzMjTmt9w5lqNyWDqNvFpH4RzcjvwqUZR0aVehYCj9fH2FGf8a9ihQNszL5o61z3pRwdGRiAmIQ6mptfWYOITyaluJdkIX/+as7dAdpog7lCJjUF8swp1UUehBa6VenPWpoKiwxDCRegO77h6i4W70kcFrqc+wC9ffFT2TZmfzdAU8QZ4uZWgtvUy0jts1pZPS6hk11Zunu829qmLRWhdg3+nurAt2AUVckdeHoRQ1RU9oR7phxqqihqhy+u9Ipa1LVzn8APa0W03tzcb3obl6h6gOKNAu+P8VOuc648thqarM+BsUtLmIK1aJRCLRN/wCwwuevR3N2LQAAAAASUVORK5CYII=>

[image36]: <data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEUAAAAZCAYAAABnweOlAAAC1UlEQVR4Xu2XT6hNURTG1wtFSBJSFBIpSmEijKQMSDEQysRAGBlQpJQMnqGUUopkavaiiFcGxExhYCAiI0wYIPH97LO07n53n/vun/cmzle/Onedvc7Z+9tr77OvWaNGjRo1atSH9omtebAXLbX0sJJWiYviqtgvZrTe/iti3KMNbcmZbM0RT8SImJ7dG5dWi6PigfglbrTe/qc94qVYJ2aJ8+KepQ64uCbGPdrQlhxyJ1ObxU/xydL4uhZJu8Um8d7am7JEvBYHQmyueCaOh9ipKsY9FzmvxMIQm2gxKW/Eb2vtX9daJN5ae1MY2DexPsSGxC0xaqkq3KQ8f6P4KnZl8YkS/bgtDlmqlrvWfpmPS3WmXLKxpiDafhTLLVUc5Zrnk0PuhSzuwtDFYrulZ0wTGyxVLxWKmICVYm/VZkoVbyeWzjUx39IkfRFrWlp0oTpTiJVM8bgPPs8vxV0M/oOlUmdzvmmpMs9YyjtcxU+II1Xby2IqyW3E0vGPBRPR1xIqmcJMjlpnU3Za6kCe38kURKWwn8W9Z7Z4JL6LLVUMMVD6SX9z+dJZVv32DbfnJVQyZaa4b51N2WG9m+LvZpm6fDIwBoNcbOYlU3zpeBX5PtfzEiqZguLgS/HS4EvxKH83A3a5KcC1q84UqohN/V3gh/WxhOpM4WUlUyh7yp/Nlk03z3dTTmfxqEGYki8dV19LqM4UPqcc7LaFGCfFkQqufRD+20UOsxVzcw3CFJ5P3/MNuK8l5B3j7DGU3ZsnnopzIbbCUpXEvwUHLZWszxbP4WvAkTuefHP5Rhurqc6U/KRKBVwXZ21s31HXXyEcpkNUAonAunwu1oZ2nB04JZ60dF7A/WFL5woX11fEQ0ufWgx5Yem4XxKfWV/3gPmY+znEuCb2OMTIIfdYiMEdSx8HtMDS8+J9nkXewMTLOGTFg1UuZsoPWvxLjaY1atSoUaP/XX8AQaXNj/jZlqoAAAAASUVORK5CYII=>