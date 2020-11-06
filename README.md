# 仓库介绍
该仓库用于调试 Webpack Loader 相关源码，`git clone` 项目后用 VSCode 打开，然后就可以使用 VSCode 自带的调试工具开始调试。

# 解析文章

![](https://p3-juejin.byteimg.com/tos-cn-i-k3u1fbpfcp/78c57e037754493ca21dee5c1b99b9e8~tplv-k3u1fbpfcp-watermark.image)

在分析 Vue 文件编译过程时，囿于对其相关 loader 的流向不清晰，即使知道哪些 loader 发挥了什么作用，也总觉得是在雾里看花，不甚明了，于是准备走读源码分析下 loader 机制。

## 环境准备
JS 不是一门易读的语言，为了节约时间，我先创建了一个简单的工程，借此我可以调试 Webpack 的源码。

*TODO: 补充 Demo 源码地址*

### 新建目录
```bash
mkdir webpack-loader-demo
cd webpack-loader-demo
```

### 填充项目
项目预期是能让我验证 loader 的核心机制（runLoader 和 runPitch），至少需要三个自定义 loader ，至于 loader 的功能就一切从简：修改源码中的字符串。文件及内容如下：

`package.json`
```bash
npm init
yarn add webpack webpack-cli loader-utils -D
```

`index.js`
```javascript
console.log('Hello, World!')
```

`loaders/change-action/index.js`
```javascript
const { getOptions } = require('loader-utils')

module.exports = function(content) {
  console.log('change action loader trigger...')
  return content.replace('Hello', getOptions(this).action) 
}
```

`loaders/change-symbol/index.js`
```javascript
const loaderUtils = require('loader-utils')

module.exports = function(content) {
  console.log('change symbol loader trigger...')
  return content.replace('!', '...')
}

module.exports.pitch = function(remainingRequest) {
  console.log('change symbol loader pitch trigger...')
  return '// [Change by pitch] \n\nrequire(' + loaderUtils.stringifyRequest(this, '!' + remainingRequest) + ');'
}
```

`loaders/change-target/index.js`
```javascript
module.exports = function(content) {
  console.log('change target loader trigger...')
  return content.replace('World', 'Webpack Loader') 
}
```

`webpack.config.js`
```javascript
const path = require('path')

module.exports = {
  entry: './index.js',
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: 'index.js'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        use: [
          {
            loader: path.resolve(__dirname, 'loaders/change-action/index.js'),
            options: {
              action: 'Hi'
            }
          },
          path.resolve(__dirname, 'loaders/change-symbol/index.js'),
          path.resolve(__dirname, 'loaders/change-target/index.js')
        ]
      }
    ]
  }
}
```

以上内容已经足够支撑调试了，预期是 Webpack 打包后输出字符串变为了 `Hello, Webpack Loader!` , change-symbol loader 和 change-action loader 被 change-symbol loader 的 pitch 方法阻断。

*以上预期只针对上文展示代码，可以通过修改以上配置，验证各种情况下 loader 执行的机制*

### 调试准备
Demo 项目有了，但要通过调试辅助源码阅读，还需要解决一个问题：把断点打到源码中去。我通常使用 VSCode 作为 Nodejs 的调试工具，故下面的调试配置也只针对 VSCode 。

VSCode 可以通过配置 `.vscode/launch.json` 开启编辑器内的断点调试，创建方式有多种（任选其一）：
1. 手动创建这个文件
2. 点击左侧菜单中的 Debug 菜单，并在侧边 pannel 中选择创建 launch.json
3. 通过 `ctrl + shift + p` 唤出命令栏，输入 `launch.json` 后选择创建

创建时选择 Node.js 的调试配置，然后我们就可以看到在 `configurations` 中存在一个 `program` 的配置值，它指定的就是 node 执行的目标文件。但当前项目使用 Webpack 打包时执行的命令是 `webpack --config webpack.config.js` ，其中并不存在入口文件，所以我们还需要使用 Webpack Nodejs 的 API ，如下：

`build.js`
```javascript
const webpack = require('webpack')
const webpackConfig = require('./webpack.config')

webpack(webpackConfig, (err, stats) => {
})
```

`.vscode/launch.json`
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Webapack",
      "skipFiles": [
        "<node_internals>/**"
      ],
      "program": "${workspaceFolder}\\build.js"
    }
  ]
}
```
配置好这两个文件，我就可以在 Webpack 打包过程中的任意位置添加断点了，下面就进入源码阅读。

## 源码阅读
本文会忽略在这 `create` `createCompiler` 等等关联不大的逻辑，直接从创建 module 的 `createNormalModuleFactory` 方法开始（`rules` 是 module 的一部分）。

### webpack/lib/Compiler.js
```javascript
newCompilationParams() {
    const params = {
        normalModuleFactory: this.createNormalModuleFactory(),
        contextModuleFactory: this.createContextModuleFactory()
    };
    return params;
}

createNormalModuleFactory() {
    // 初始化 NormalModuleFactory 
    const normalModuleFactory = new NormalModuleFactory({
        context: this.options.context,
        fs: this.inputFileSystem,
        resolverFactory: this.resolverFactory,
        options: this.options.module || {},
        associatedObjectForCache: this.root
    });
    this.hooks.normalModuleFactory.call(normalModuleFactory);
    return normalModuleFactory;
}
```
从 `options` 中取出 `module` 配置项，传入创建 `NormalModuleFactory` 构造函数。

### webpack/lib/NormalModuleFactory.js
```javascript
class NormalModuleFactory extends ModuleFactory {
  constructor({
      context,
      fs,
      resolverFactory,
      options,
      associatedObjectForCache
  }) {
      ... 
      // 序列化并把 rules 编译为固定格式（RuleSet 相关逻辑本文略过）
      this.ruleSet = ruleSetCompiler.compile([
          {
              rules: options.defaultRules
          },
          {
              rules: options.rules
          }
      ]);
      ...
      const result = this.ruleSet.exec({
          resource: resourceDataForRules.path,
          realResource: resourceData.path,
          resourceQuery: resourceDataForRules.query,
          resourceFragment: resourceDataForRules.fragment,
          mimetype: matchResourceData ? "" : resourceData.data.mimetype || "",
          dependency: dependencyType,
          descriptionData: matchResourceData
              ? undefined
              : resourceData.data.descriptionFileData,
          issuer: contextInfo.issuer,
          compiler: contextInfo.compiler
      });
      
      const settings = {};
      const useLoadersPost = [];
      const useLoaders = [];
      const useLoadersPre = [];
      // 根据 `Rule.enforce` 配置给 loaders 分组
      for (const r of result) {
          if (r.type === "use") {
              if (!noAutoLoaders && !noPrePostAutoLoaders) {
                  useLoaders.push(r.value);
              }
          } else if (r.type === "use-post") {
              if (!noPrePostAutoLoaders) {
                  useLoadersPost.push(r.value);
              }
          } else if (r.type === "use-pre") {
              if (!noPreAutoLoaders && !noPrePostAutoLoaders) {
                  useLoadersPre.push(r.value);
              }
          } else if (
              typeof r.value === "object" &&
              r.value !== null &&
              typeof settings[r.type] === "object" &&
              settings[r.type] !== null
          ) {
              settings[r.type] = cachedCleverMerge(settings[r.type], r.value);
          } else {
              settings[r.type] = r.value;
          }
      }
      ...
      
      this.hooks.createModule.callAsync(
          createData,
          resolveData,
          (err, createdModule) => {
              if (!createdModule) {
                  if (!resolveData.request) {
                      return callback(new Error("Empty dependency (no request)"));
                  }
                  
                  // 创建 NormalModule 实例， `createData.loaders` 存放合法的 loader 路径
                  createdModule = new NormalModule(createData);
              }

              createdModule = this.hooks.module.call(
                  createdModule,
                  createData,
                  resolveData
              );
              
              return callback(null, createdModule);
          }
      );
      ...
  }
}
```
`RuleSet` 处理 loader 配置，并用于创建 `NormalModule` 实例。

### webpack/lib/NormalModule.js
```javascript
build(options, compilation, resolver, fs, callback) {
  ...
  return this.doBuild(...)
  ...
}

doBuild(options, compilation, resolver, fs, callback) {
  // 创建 module 的上下文对象
  const loaderContext = this.createLoaderContext(
    resolver,
    options,
    compilation,
    fs
  );
  
  ...
  // 执行 loader
  runLoaders(
    {
      resource: this.resource,
      loaders: this.loaders,
      context: loaderContext,
      readResource: (resource, callback) => {
        const scheme = getScheme(resource);
        if (scheme) {
          hooks.readResourceForScheme
            .for(scheme)
            .callAsync(resource, this, (err, result) => {
                if (err) return callback(err);
                if (typeof result !== "string" && !result) {
                    return callback(new UnhandledSchemeError(scheme, resource));
                }
                return callback(null, result);
            });
        } else {
          fs.readFile(resource, callback);
        }
      }
    },
    (err, result) => { ... })
}
```
调用 `NormalModule` 的 `build` 方法，它主要做两件事：
1. 生成 loader 的上下文环境 `loaderContext`
2. 执行 `runLoaders` 方法

### loader-runner/lib/LoaderRunner.js
```javascript
function runLoaders(options, callback) {
  ...
  // 创建 loader 对象，存在一个自定义的 `request` 属性
  loaders = loaders.map(createLoaderObject);
  
  ...
  // 向 `loaderContext` 添加 `request` 属性
  Object.defineProperty(loaderContext, "request", {
    enumerable: true,
    get: function() {
      return loaderContext.loaders.map(function(o) {
          // 返回 loader 对象的 `request` 属性
          return o.request;
      }).concat(loaderContext.resource || "").join("!");
    }
  });
  
  ...
  // 向 `loaderContext` 添加 `remainingRequest|currentRequest|previousRequest|query|data` 属性
  
  ...
  // 递归执行 loader pitch
  iteratePitchingLoaders(processOptions, loaderContext, function(err, result) {
    if(err) {
      return callback(err, {
          cacheable: requestCacheable,
          fileDependencies: fileDependencies,
          contextDependencies: contextDependencies,
          missingDependencies: missingDependencies
      });
    }
    callback(null, {
        result: result,
        resourceBuffer: processOptions.resourceBuffer,
        cacheable: requestCacheable,
        fileDependencies: fileDependencies,
        contextDependencies: contextDependencies,
        missingDependencies: missingDependencies
    });
  });
}
```

```javascript
function iteratePitchingLoaders(options, loaderContext, callback) {
	// abort after last loader
	if(loaderContext.loaderIndex >= loaderContext.loaders.length)
		return processResource(options, loaderContext, callback);
    
	// 取得当前 loader 对象
	var currentLoaderObject = loaderContext.loaders[loaderContext.loaderIndex];

	// 如果 pitch 被执行过则进入下一次循环
	if(currentLoaderObject.pitchExecuted) {
		loaderContext.loaderIndex++;
		return iteratePitchingLoaders(options, loaderContext, callback);
	}

	// 加载 loader 模块，兼容 esm 和 cjs
	loadLoader(currentLoaderObject, function(err) {
		if(err) {
			loaderContext.cacheable(false);
			return callback(err);
		}
		var fn = currentLoaderObject.pitch;
		// 改变执行状态
		currentLoaderObject.pitchExecuted = true;
		if(!fn) return iteratePitchingLoaders(options, loaderContext, callback);

		// 执行 pitch 函数
		runSyncOrAsync(
			fn,
			loaderContext, [loaderContext.remainingRequest, loaderContext.previousRequest, currentLoaderObject.data = {}],
			function(err) {
				if(err) return callback(err);
				var args = Array.prototype.slice.call(arguments, 1);
				// Determine whether to continue the pitching process based on
				// argument values (as opposed to argument presence) in order
				// to support synchronous and asynchronous usages.
				// 根据 pitch 函数是否有返回值，决定不同的流程
				var hasArg = args.some(function(value) {
					return value !== undefined;
				});
				if(hasArg) {
					// 如果有返回值，跳过当前 loader 并进入 normal loader 递归执行
					// 跳过当前 loader
					loaderContext.loaderIndex--;
					iterateNormalLoaders(options, loaderContext, args, callback);
				} else {
					iteratePitchingLoaders(options, loaderContext, callback);
				}
			}
		);
	});
}
```
`iteratePitchingLoaders` 会从 `loaderIndex = 0` 开始递归执行 loaders 的 `pitch` 方法，也就是说 `pitch` 方法的执行顺序是：从左往右、从上往下。执行过程中，如果某一个 loader 的 `pitch` 函数返回了非 `undifined` 的值，则会跳出当前 pitch 递归流程，进入 loader 主体的递归流程。还需注意的一点是，`iteratePitchingLoaders` 和 `iterateNormalLoaders` 两个函数中用于取当前 loader 对象的的偏移量 `loaderIndex` 是 `loaderContext` 的属性、是共享的，所以执行 `iterateNormalLoaders` 前的 `loaderContext.loaderIndex--` 表明，在执行 loader 主体时不仅会跳过未处理的 loaders ，还会跳过当前 loader。

```javascript
function iterateNormalLoaders(options, loaderContext, args, callback) {
	if(loaderContext.loaderIndex < 0)
		return callback(null, args);

	var currentLoaderObject = loaderContext.loaders[loaderContext.loaderIndex];

	// iterate
	if(currentLoaderObject.normalExecuted) {
		loaderContext.loaderIndex--;
		return iterateNormalLoaders(options, loaderContext, args, callback);
	}

	var fn = currentLoaderObject.normal;
	currentLoaderObject.normalExecuted = true;
	if(!fn) {
		return iterateNormalLoaders(options, loaderContext, args, callback);
	}

	convertArgs(args, currentLoaderObject.raw);

	runSyncOrAsync(fn, loaderContext, args, function(err) {
		if(err) return callback(err);

		var args = Array.prototype.slice.call(arguments, 1);
		iterateNormalLoaders(options, loaderContext, args, callback);
	});
}
```
`iterateNormalLoaders` 比较简单，就是递归执行 loader 主体，并把处理结果返回给下一个 loader ，只有一点需要注意：若存在某个 loader 的 `pitch` 函数有返回值，那么 `iterateNormalLoaders` 最初接收的参数就不是处理目标的源代码了，而是 `pitch` 的返回值。

```javascript
function runSyncOrAsync(fn, context, args, callback) {
	...
	try {
		// 执行 pitch 方法
		var result = (function LOADER_EXECUTION() {
			return fn.apply(context, args);
		}());
		if(isSync) {
			isDone = true;
			if(result === undefined)
				return callback();
			if(result && typeof result === "object" && typeof result.then === "function") {
				return result.then(function(r) {
					// 异步，执行 callback 传递 pitch 结果
					callback(null, r);
				}, callback);
			}
			// 同步，执行 callback 传递 pitch 结果
			return callback(null, result);
		}
	} catch(e) { ... }
}
```
在上面的两个迭代器函数中，都使用 `runSyncOrAsync` 这个来执行的 loader 内的函数， 看起来挺让人迷惑，其实它只是整合了同步、异步 loader 内容的执行。

## 总结

阅读过 loader 相关代码后，我下意识地就将其运转规则和[职责链](https://www.runoob.com/design-pattern/chain-of-responsibility-pattern.html)关联了起来，虽然在 Webpack 在实现上有别与传统的链表结构，采用控制 Array 索引实现递归的方式，但原理都是一致的：每一个 loader 都有既定的职责，职责完成后将处理权移交给下一个 loader 。

为了方便详细描述，我们假设配置了三个 loader 处理 index.js `./index.js!a-loader.js!b-loader.js!c-loader.js` ：
1. Webpack会**先从左往右、从上往下**依次执行 a/b/c loader 的 `pitch` 方法，**再从右往左、从下往上**依次执行 a/b/c loader 的方法主体。
2. 在 pitch 过程中如果某个 `pitch` 存在返回值，则不会再执行剩余的 `pitch` 函数，直接开始逆向执行 `pitch` 没有返回结果的 laoder 的主体方法。

是不是觉得很像 DOM 的事件处理流程呢？当然像了，因为浏览器 DOM 的事件捕获和冒泡也是职责链模式的实现。

*文章发布于[掘金](https://juejin.im/post/6891905811820806158)*