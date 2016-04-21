import { isPresent, isBlank } from 'angular2/src/facade/lang';
import { ListWrapper } from 'angular2/src/facade/collection';
import { BaseException } from 'angular2/src/facade/exceptions';
import * as o from '../output/output_ast';
import { Identifiers, identifierToken } from '../identifiers';
import { EventHandlerVars } from './constants';
import { CompileQuery, createQueryList, addQueryToTokenMap } from './compile_query';
import { CompileMethod } from './compile_method';
import { ViewType } from 'angular2/src/core/linker/view_type';
import { CompileIdentifierMetadata, CompileTokenMap } from '../compile_metadata';
import { getViewFactoryName, injectFromViewParentInjector, getPropertyInView } from './util';
import { bindPipeDestroyLifecycleCallbacks } from './lifecycle_binder';
export class CompilePipe {
    constructor() {
    }
}
export class CompileView {
    constructor(component, genConfig, pipeMetas, styles, viewIndex, declarationElement, templateVariableBindings) {
        this.component = component;
        this.genConfig = genConfig;
        this.pipeMetas = pipeMetas;
        this.styles = styles;
        this.viewIndex = viewIndex;
        this.declarationElement = declarationElement;
        this.templateVariableBindings = templateVariableBindings;
        this.nodes = [];
        // root nodes or AppElements for ViewContainers
        this.rootNodesOrAppElements = [];
        this.bindings = [];
        this.classStatements = [];
        this.eventHandlerMethods = [];
        this.fields = [];
        this.getters = [];
        this.disposables = [];
        this.subscriptions = [];
        this.pipes = new Map();
        this.variables = new Map();
        this.literalArrayCount = 0;
        this.literalMapCount = 0;
        this.createMethod = new CompileMethod(this);
        this.injectorGetMethod = new CompileMethod(this);
        this.updateContentQueriesMethod = new CompileMethod(this);
        this.dirtyParentQueriesMethod = new CompileMethod(this);
        this.updateViewQueriesMethod = new CompileMethod(this);
        this.detectChangesInInputsMethod = new CompileMethod(this);
        this.detectChangesRenderPropertiesMethod = new CompileMethod(this);
        this.afterContentLifecycleCallbacksMethod = new CompileMethod(this);
        this.afterViewLifecycleCallbacksMethod = new CompileMethod(this);
        this.destroyMethod = new CompileMethod(this);
        this.viewType = getViewType(component, viewIndex);
        this.className = `_View_${component.type.name}${viewIndex}`;
        this.classType = o.importType(new CompileIdentifierMetadata({ name: this.className }));
        this.viewFactory = o.variable(getViewFactoryName(component, viewIndex));
        if (this.viewType === ViewType.COMPONENT || this.viewType === ViewType.HOST) {
            this.componentView = this;
        }
        else {
            this.componentView = this.declarationElement.view.componentView;
        }
        var viewQueries = new CompileTokenMap();
        if (this.viewType === ViewType.COMPONENT) {
            var directiveInstance = o.THIS_EXPR.prop('context');
            ListWrapper.forEachWithIndex(this.component.viewQueries, (queryMeta, queryIndex) => {
                var propName = `_viewQuery_${queryMeta.selectors[0].name}_${queryIndex}`;
                var queryList = createQueryList(queryMeta, directiveInstance, propName, this);
                var query = new CompileQuery(queryMeta, queryList, directiveInstance, this);
                addQueryToTokenMap(viewQueries, query);
            });
            var constructorViewQueryCount = 0;
            this.component.type.diDeps.forEach((dep) => {
                if (isPresent(dep.viewQuery)) {
                    var queryList = o.THIS_EXPR.prop('declarationAppElement')
                        .prop('componentConstructorViewQueries')
                        .key(o.literal(constructorViewQueryCount++));
                    var query = new CompileQuery(dep.viewQuery, queryList, null, this);
                    addQueryToTokenMap(viewQueries, query);
                }
            });
        }
        this.viewQueries = viewQueries;
        templateVariableBindings.forEach((entry) => {
            this.variables.set(entry[1], o.THIS_EXPR.prop('locals').key(o.literal(entry[0])));
        });
        if (!this.declarationElement.isNull()) {
            this.declarationElement.setEmbeddedView(this);
        }
    }
    createPipe(name) {
        var pipeMeta = null;
        for (var i = this.pipeMetas.length - 1; i >= 0; i--) {
            var localPipeMeta = this.pipeMetas[i];
            if (localPipeMeta.name == name) {
                pipeMeta = localPipeMeta;
                break;
            }
        }
        if (isBlank(pipeMeta)) {
            throw new BaseException(`Illegal state: Could not find pipe ${name} although the parser should have detected this error!`);
        }
        var pipeFieldName = pipeMeta.pure ? `_pipe_${name}` : `_pipe_${name}_${this.pipes.size}`;
        var pipeExpr = this.pipes.get(pipeFieldName);
        if (isBlank(pipeExpr)) {
            var deps = pipeMeta.type.diDeps.map((diDep) => {
                if (diDep.token.equalsTo(identifierToken(Identifiers.ChangeDetectorRef))) {
                    return o.THIS_EXPR.prop('ref');
                }
                return injectFromViewParentInjector(diDep.token, false);
            });
            this.fields.push(new o.ClassField(pipeFieldName, o.importType(pipeMeta.type), [o.StmtModifier.Private]));
            this.createMethod.resetDebugInfo(null, null);
            this.createMethod.addStmt(o.THIS_EXPR.prop(pipeFieldName)
                .set(o.importExpr(pipeMeta.type).instantiate(deps))
                .toStmt());
            pipeExpr = o.THIS_EXPR.prop(pipeFieldName);
            this.pipes.set(pipeFieldName, pipeExpr);
            bindPipeDestroyLifecycleCallbacks(pipeMeta, pipeExpr, this);
        }
        return pipeExpr;
    }
    getVariable(name) {
        if (name == EventHandlerVars.event.name) {
            return EventHandlerVars.event;
        }
        var currView = this;
        var result = currView.variables.get(name);
        var viewPath = [];
        while (isBlank(result) && isPresent(currView.declarationElement.view)) {
            currView = currView.declarationElement.view;
            result = currView.variables.get(name);
            viewPath.push(currView);
        }
        if (isPresent(result)) {
            return getPropertyInView(result, viewPath);
        }
        else {
            return null;
        }
    }
    createLiteralArray(values) {
        return o.THIS_EXPR.callMethod('literalArray', [o.literal(this.literalArrayCount++), o.literalArr(values)]);
    }
    createLiteralMap(values) {
        return o.THIS_EXPR.callMethod('literalMap', [o.literal(this.literalMapCount++), o.literalMap(values)]);
    }
    afterNodes() {
        this.viewQueries.values().forEach((queries) => queries.forEach((query) => query.afterChildren(this.updateViewQueriesMethod)));
    }
}
function getViewType(component, embeddedTemplateIndex) {
    if (embeddedTemplateIndex > 0) {
        return ViewType.EMBEDDED;
    }
    else if (component.type.isHost) {
        return ViewType.HOST;
    }
    else {
        return ViewType.COMPONENT;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY29tcGlsZV92aWV3LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZGlmZmluZ19wbHVnaW5fd3JhcHBlci1vdXRwdXRfcGF0aC1OU0pacjA3MC50bXAvYW5ndWxhcjIvc3JjL2NvbXBpbGVyL3ZpZXdfY29tcGlsZXIvY29tcGlsZV92aWV3LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJPQUFPLEVBQUMsU0FBUyxFQUFFLE9BQU8sRUFBQyxNQUFNLDBCQUEwQjtPQUNwRCxFQUFDLFdBQVcsRUFBbUIsTUFBTSxnQ0FBZ0M7T0FDckUsRUFBQyxhQUFhLEVBQUMsTUFBTSxnQ0FBZ0M7T0FFckQsS0FBSyxDQUFDLE1BQU0sc0JBQXNCO09BQ2xDLEVBQUMsV0FBVyxFQUFFLGVBQWUsRUFBQyxNQUFNLGdCQUFnQjtPQUNwRCxFQUFDLGdCQUFnQixFQUFDLE1BQU0sYUFBYTtPQUNyQyxFQUFDLFlBQVksRUFBRSxlQUFlLEVBQUUsa0JBQWtCLEVBQUMsTUFBTSxpQkFBaUI7T0FHMUUsRUFBQyxhQUFhLEVBQUMsTUFBTSxrQkFBa0I7T0FDdkMsRUFBQyxRQUFRLEVBQUMsTUFBTSxvQ0FBb0M7T0FDcEQsRUFHTCx5QkFBeUIsRUFDekIsZUFBZSxFQUNoQixNQUFNLHFCQUFxQjtPQUNyQixFQUNMLGtCQUFrQixFQUNsQiw0QkFBNEIsRUFFNUIsaUJBQWlCLEVBQ2xCLE1BQU0sUUFBUTtPQUlSLEVBQUMsaUNBQWlDLEVBQUMsTUFBTSxvQkFBb0I7QUFFcEU7SUFDRTtJQUFlLENBQUM7QUFDbEIsQ0FBQztBQUVEO0lBc0NFLFlBQW1CLFNBQW1DLEVBQVMsU0FBeUIsRUFDckUsU0FBZ0MsRUFBUyxNQUFvQixFQUM3RCxTQUFpQixFQUFTLGtCQUFrQyxFQUM1RCx3QkFBb0M7UUFIcEMsY0FBUyxHQUFULFNBQVMsQ0FBMEI7UUFBUyxjQUFTLEdBQVQsU0FBUyxDQUFnQjtRQUNyRSxjQUFTLEdBQVQsU0FBUyxDQUF1QjtRQUFTLFdBQU0sR0FBTixNQUFNLENBQWM7UUFD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LFFBQVEsQ0FBQyxJQUFJLENBQUM7SUFDdkIsQ0FBQztJQUFDLElBQUksQ0FBQyxDQUFDO1FBQ04sTUFBTSxDQUFDLFFBQVEsQ0FBQyxTQUFTLENBQUM7SUFDNUIsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge2lzUHJlc2VudCwgaXNCbGFua30gZnJvbSAnYW5ndWxhcjIvc3JjL2ZhY2FkZS9sYW5nJztcbmltcG9ydCB7TGlzdFdyYXBwZXIsIFN0cmluZ01hcFdyYXBwZXJ9IGZyb20gJ2FuZ3VsYXIyL3NyYy9mYWNhZGUvY29sbGVjdGlvbic7XG5pbXBvcnQge0Jhc2VFeGNlcHRpb259IGZyb20gJ2FuZ3VsYXIyL3NyYy9mYWNhZGUvZXhjZXB0aW9ucyc7XG5cbmltcG9ydCAqIGFzIG8gZnJvbSAnLi4vb3V0cHV0L291dHB1dF9hc3QnO1xuaW1wb3J0IHtJZGVudGlmaWVycywgaWRlbnRpZmllclRva2VufSBmcm9tICcuLi9pZGVudGlmaWVycyc7XG5pbXBvcnQge0V2ZW50SGFuZGxlclZhcnN9IGZyb20gJy4vY29uc3RhbnRzJztcbmltcG9ydCB7Q29tcGlsZVF1ZXJ5LCBjcmVhdGVRdWVyeUxpc3QsIGFkZFF1ZXJ5VG9Ub2tlbk1hcH0gZnJvbSAnLi9jb21waWxlX3F1ZXJ5JztcbmltcG9ydCB7TmFtZVJlc29sdmVyfSBmcm9tICcuL2V4cHJlc3Npb25fY29udmVydGVyJztcbmltcG9ydCB7Q29tcGlsZUVsZW1lbnQsIENvbXBpbGVOb2RlfSBmcm9tICcuL2NvbXBpbGVfZWxlbWVudCc7XG5pbXBvcnQge0NvbXBpbGVNZXRob2R9IGZyb20gJy4vY29tcGlsZV9tZXRob2QnO1xuaW1wb3J0IHtWaWV3VHlwZX0gZnJvbSAnYW5ndWxhcjIvc3JjL2NvcmUvbGlua2VyL3ZpZXdfdHlwZSc7XG5pbXBvcnQge1xuICBDb21waWxlRGlyZWN0aXZlTWV0YWRhdGEsXG4gIENvbXBpbGVQaXBlTWV0YWRhdGEsXG4gIENvbXBpbGVJZGVudGlmaWVyTWV0YWRhdGEsXG4gIENvbXBpbGVUb2tlbk1hcFxufSBmcm9tICcuLi9jb21waWxlX21ldGFkYXRhJztcbmltcG9ydCB7XG4gIGdldFZpZXdGYWN0b3J5TmFtZSxcbiAgaW5qZWN0RnJvbVZpZXdQYXJlbnRJbmplY3RvcixcbiAgY3JlYXRlRGlUb2tlbkV4cHJlc3Npb24sXG4gIGdldFByb3BlcnR5SW5WaWV3XG59IGZyb20gJy4vdXRpbCc7XG5pbXBvcnQge0NvbXBpbGVyQ29uZmlnfSBmcm9tICcuLi9jb25maWcnO1xuaW1wb3J0IHtDb21waWxlQmluZGluZ30gZnJvbSAnLi9jb21waWxlX2JpbmRpbmcnO1xuXG5pbXBvcnQge2JpbmRQaXBlRGVzdHJveUxpZmVjeWNsZUNhbGxiYWNrc30gZnJvbSAnLi9saWZlY3ljbGVfYmluZGVyJztcblxuZXhwb3J0IGNsYXNzIENvbXBpbGVQaXBlIHtcbiAgY29uc3RydWN0b3IoKSB7fVxufVxuXG5leHBvcnQgY2xhc3MgQ29tcGlsZVZpZXcgaW1wbGVtZW50cyBOYW1lUmVzb2x2ZXIge1xuICBwdWJsaWMgdmlld1R5cGU6IFZpZXdUeXBlO1xuICBwdWJsaWMgdmlld1F1ZXJpZXM6IENvbXBpbGVUb2tlbk1hcDxDb21waWxlUXVlcnlbXT47XG5cbiAgcHVibGljIG5vZGVzOiBDb21waWxlTm9kZVtdID0gW107XG4gIC8vIHJvb3Qgbm9kZXMgb3IgQXBwRWxlbWVudHMgZm9yIFZpZXdDb250YWluZXJzXG4gIHB1YmxpYyByb290Tm9kZXNPckFwcEVsZW1lbnRzOiBvLkV4cHJlc3Npb25bXSA9IFtdO1xuXG4gIHB1YmxpYyBiaW5kaW5nczogQ29tcGlsZUJpbmRpbmdbXSA9IFtdO1xuXG4gIHB1YmxpYyBjbGFzc1N0YXRlbWVudHM6IG8uU3RhdGVtZW50W10gPSBbXTtcbiAgcHVibGljIGNyZWF0ZU1ldGhvZDogQ29tcGlsZU1ldGhvZDtcbiAgcHVibGljIGluamVjdG9yR2V0TWV0aG9kOiBDb21waWxlTWV0aG9kO1xuICBwdWJsaWMgdXBkYXRlQ29udGVudFF1ZXJpZXNNZXRob2Q6IENvbXBpbGVNZXRob2Q7XG4gIHB1YmxpYyBkaXJ0eVBhcmVudFF1ZXJpZXNNZXRob2Q6IENvbXBpbGVNZXRob2Q7XG4gIHB1YmxpYyB1cGRhdGVWaWV3UXVlcmllc01ldGhvZDogQ29tcGlsZU1ldGhvZDtcbiAgcHVibGljIGRldGVjdENoYW5nZXNJbklucHV0c01ldGhvZDogQ29tcGlsZU1ldGhvZDtcbiAgcHVibGljIGRldGVjdENoYW5nZXNSZW5kZXJQcm9wZXJ0aWVzTWV0aG9kOiBDb21waWxlTWV0aG9kO1xuICBwdWJsaWMgYWZ0ZXJDb250ZW50TGlmZWN5Y2xlQ2FsbGJhY2tzTWV0aG9kOiBDb21waWxlTWV0aG9kO1xuICBwdWJsaWMgYWZ0ZXJWaWV3TGlmZWN5Y2xlQ2FsbGJhY2tzTWV0aG9kOiBDb21waWxlTWV0aG9kO1xuICBwdWJsaWMgZGVzdHJveU1ldGhvZDogQ29tcGlsZU1ldGhvZDtcbiAgcHVibGljIGV2ZW50SGFuZGxlck1ldGhvZHM6IG8uQ2xhc3NNZXRob2RbXSA9IFtdO1xuXG4gIHB1YmxpYyBmaWVsZHM6IG8uQ2xhc3NGaWVsZFtdID0gW107XG4gIHB1YmxpYyBnZXR0ZXJzOiBvLkNsYXNzR2V0dGVyW10gPSBbXTtcbiAgcHVibGljIGRpc3Bvc2FibGVzOiBvLkV4cHJlc3Npb25bXSA9IFtdO1xuICBwdWJsaWMgc3Vic2NyaXB0aW9uczogby5FeHByZXNzaW9uW10gPSBbXTtcblxuICBwdWJsaWMgY29tcG9uZW50VmlldzogQ29tcGlsZVZpZXc7XG4gIHB1YmxpYyBwaXBlcyA9IG5ldyBNYXA8c3RyaW5nLCBvLkV4cHJlc3Npb24+KCk7XG4gIHB1YmxpYyB2YXJpYWJsZXMgPSBuZXcgTWFwPHN0cmluZywgby5FeHByZXNzaW9uPigpO1xuICBwdWJsaWMgY2xhc3NOYW1lOiBzdHJpbmc7XG4gIHB1YmxpYyBjbGFzc1R5cGU6IG8uVHlwZTtcbiAgcHVibGljIHZpZXdGYWN0b3J5OiBvLlJlYWRWYXJFeHByO1xuXG4gIHB1YmxpYyBsaXRlcmFsQXJyYXlDb3VudCA9IDA7XG4gIHB1YmxpYyBsaXRlcmFsTWFwQ291bnQgPSAwO1xuXG4gIGNvbnN0cnVjdG9yKHB1YmxpYyBjb21wb25lbnQ6IENvbXBpbGVEaXJlY3RpdmVNZXRhZGF0YSwgcHVibGljIGdlbkNvbmZpZzogQ29tcGlsZXJDb25maWcsXG4gICAgICAgICAgICAgIHB1YmxpYyBwaXBlTWV0YXM6IENvbXBpbGVQaXBlTWV0YWRhdGFbXSwgcHVibGljIHN0eWxlczogby5FeHByZXNzaW9uLFxuICAgICAgICAgICAgICBwdWJsaWMgdmlld0luZGV4OiBudW1iZXIsIHB1YmxpYyBkZWNsYXJhdGlvbkVsZW1lbnQ6IENvbXBpbGVFbGVtZW50LFxuICAgICAgICAgICAgICBwdWJsaWMgdGVtcGxhdGVWYXJpYWJsZUJpbmRpbmdzOiBzdHJpbmdbXVtdKSB7XG4gICAgdGhpcy5jcmVhdGVNZXRob2QgPSBuZXcgQ29tcGlsZU1ldGhvZCh0aGlzKTtcbiAgICB0aGlzLmluamVjdG9yR2V0TWV0aG9kID0gbmV3IENvbXBpbGVNZXRob2QodGhpcyk7XG4gICAgdGhpcy51cGRhdGVDb250ZW50UXVlcmllc01ldGhvZCA9IG5ldyBDb21waWxlTWV0aG9kKHRoaXMpO1xuICAgIHRoaXMuZGlydHlQYXJlbnRRdWVyaWVzTWV0aG9kID0gbmV3IENvbXBpbGVNZXRob2QodGhpcyk7XG4gICAgdGhpcy51cGRhdGVWaWV3UXVlcmllc01ldGhvZCA9IG5ldyBDb21waWxlTWV0aG9kKHRoaXMpO1xuICAgIHRoaXMuZGV0ZWN0Q2hhbmdlc0luSW5wdXRzTWV0aG9kID0gbmV3IENvbXBpbGVNZXRob2QodGhpcyk7XG4gICAgdGhpcy5kZXRlY3RDaGFuZ2VzUmVuZGVyUHJvcGVydGllc01ldGhvZCA9IG5ldyBDb21waWxlTWV0aG9kKHRoaXMpO1xuXG4gICAgdGhpcy5hZnRlckNvbnRlbnRMaWZlY3ljbGVDYWxsYmFja3NNZXRob2QgPSBuZXcgQ29tcGlsZU1ldGhvZCh0aGlzKTtcbiAgICB0aGlzLmFmdGVyVmlld0xpZmVjeWNsZUNhbGxiYWNrc01ldGhvZCA9IG5ldyBDb21waWxlTWV0aG9kKHRoaXMpO1xuICAgIHRoaXMuZGVzdHJveU1ldGhvZCA9IG5ldyBDb21waWxlTWV0aG9kKHRoaXMpO1xuXG4gICAgdGhpcy52aWV3VHlwZSA9IGdldFZpZXdUeXBlKGNvbXBvbmVudCwgdmlld0luZGV4KTtcbiAgICB0aGlzLmNsYXNzTmFtZSA9IGBfVmlld18ke2NvbXBvbmVudC50eXBlLm5hbWV9JHt2aWV3SW5kZXh9YDtcbiAgICB0aGlzLmNsYXNzVHlwZSA9IG8uaW1wb3J0VHlwZShuZXcgQ29tcGlsZUlkZW50aWZpZXJNZXRhZGF0YSh7bmFtZTogdGhpcy5jbGFzc05hbWV9KSk7XG4gICAgdGhpcy52aWV3RmFjdG9yeSA9IG8udmFyaWFibGUoZ2V0Vmlld0ZhY3RvcnlOYW1lKGNvbXBvbmVudCwgdmlld0luZGV4KSk7XG4gICAgaWYgKHRoaXMudmlld1R5cGUgPT09IFZpZXdUeXBlLkNPTVBPTkVOVCB8fCB0aGlzLnZpZXdUeXBlID09PSBWaWV3VHlwZS5IT1NUKSB7XG4gICAgICB0aGlzLmNvbXBvbmVudFZpZXcgPSB0aGlzO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmNvbXBvbmVudFZpZXcgPSB0aGlzLmRlY2xhcmF0aW9uRWxlbWVudC52aWV3LmNvbXBvbmVudFZpZXc7XG4gICAgfVxuICAgIHZhciB2aWV3UXVlcmllcyA9IG5ldyBDb21waWxlVG9rZW5NYXA8Q29tcGlsZVF1ZXJ5W10+KCk7XG4gICAgaWYgKHRoaXMudmlld1R5cGUgPT09IFZpZXdUeXBlLkNPTVBPTkVOVCkge1xuICAgICAgdmFyIGRpcmVjdGl2ZUluc3RhbmNlID0gby5USElTX0VYUFIucHJvcCgnY29udGV4dCcpO1xuICAgICAgTGlzdFdyYXBwZXIuZm9yRWFjaFdpdGhJbmRleCh0aGlzLmNvbXBvbmVudC52aWV3UXVlcmllcywgKHF1ZXJ5TWV0YSwgcXVlcnlJbmRleCkgPT4ge1xuICAgICAgICB2YXIgcHJvcE5hbWUgPSBgX3ZpZXdRdWVyeV8ke3F1ZXJ5TWV0YS5zZWxlY3RvcnNbMF0ubmFtZX1fJHtxdWVyeUluZGV4fWA7XG4gICAgICAgIHZhciBxdWVyeUxpc3QgPSBjcmVhdGVRdWVyeUxpc3QocXVlcnlNZXRhLCBkaXJlY3RpdmVJbnN0YW5jZSwgcHJvcE5hbWUsIHRoaXMpO1xuICAgICAgICB2YXIgcXVlcnkgPSBuZXcgQ29tcGlsZVF1ZXJ5KHF1ZXJ5TWV0YSwgcXVlcnlMaXN0LCBkaXJlY3RpdmVJbnN0YW5jZSwgdGhpcyk7XG4gICAgICAgIGFkZFF1ZXJ5VG9Ub2tlbk1hcCh2aWV3UXVlcmllcywgcXVlcnkpO1xuICAgICAgfSk7XG4gICAgICB2YXIgY29uc3RydWN0b3JWaWV3UXVlcnlDb3VudCA9IDA7XG4gICAgICB0aGlzLmNvbXBvbmVudC50eXBlLmRpRGVwcy5mb3JFYWNoKChkZXApID0+IHtcbiAgICAgICAgaWYgKGlzUHJlc2VudChkZXAudmlld1F1ZXJ5KSkge1xuICAgICAgICAgIHZhciBxdWVyeUxpc3QgPSBvLlRISVNfRVhQUi5wcm9wKCdkZWNsYXJhdGlvbkFwcEVsZW1lbnQnKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLnByb3AoJ2NvbXBvbmVudENvbnN0cnVjdG9yVmlld1F1ZXJpZXMnKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgLmtleShvLmxpdGVyYWwoY29uc3RydWN0b3JWaWV3UXVlcnlDb3VudCsrKSk7XG4gICAgICAgICAgdmFyIHF1ZXJ5ID0gbmV3IENvbXBpbGVRdWVyeShkZXAudmlld1F1ZXJ5LCBxdWVyeUxpc3QsIG51bGwsIHRoaXMpO1xuICAgICAgICAgIGFkZFF1ZXJ5VG9Ub2tlbk1hcCh2aWV3UXVlcmllcywgcXVlcnkpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgdGhpcy52aWV3UXVlcmllcyA9IHZpZXdRdWVyaWVzO1xuICAgIHRlbXBsYXRlVmFyaWFibGVCaW5kaW5ncy5mb3JFYWNoKChlbnRyeSkgPT4ge1xuICAgICAgdGhpcy52YXJpYWJsZXMuc2V0KGVudHJ5WzFdLCBvLlRISVNfRVhQUi5wcm9wKCdsb2NhbHMnKS5rZXkoby5saXRlcmFsKGVudHJ5WzBdKSkpO1xuICAgIH0pO1xuXG4gICAgaWYgKCF0aGlzLmRlY2xhcmF0aW9uRWxlbWVudC5pc051bGwoKSkge1xuICAgICAgdGhpcy5kZWNsYXJhdGlvbkVsZW1lbnQuc2V0RW1iZWRkZWRWaWV3KHRoaXMpO1xuICAgIH1cbiAgfVxuXG4gIGNyZWF0ZVBpcGUobmFtZTogc3RyaW5nKTogby5FeHByZXNzaW9uIHtcbiAgICB2YXIgcGlwZU1ldGE6IENvbXBpbGVQaXBlTWV0YWRhdGEgPSBudWxsO1xuICAgIGZvciAodmFyIGkgPSB0aGlzLnBpcGVNZXRhcy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgdmFyIGxvY2FsUGlwZU1ldGEgPSB0aGlzLnBpcGVNZXRhc1tpXTtcbiAgICAgIGlmIChsb2NhbFBpcGVNZXRhLm5hbWUgPT0gbmFtZSkge1xuICAgICAgICBwaXBlTWV0YSA9IGxvY2FsUGlwZU1ldGE7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICBpZiAoaXNCbGFuayhwaXBlTWV0YSkpIHtcbiAgICAgIHRocm93IG5ldyBCYXNlRXhjZXB0aW9uKFxuICAgICAgICAgIGBJbGxlZ2FsIHN0YXRlOiBDb3VsZCBub3QgZmluZCBwaXBlICR7bmFtZX0gYWx0aG91Z2ggdGhlIHBhcnNlciBzaG91bGQgaGF2ZSBkZXRlY3RlZCB0aGlzIGVycm9yIWApO1xuICAgIH1cbiAgICB2YXIgcGlwZUZpZWxkTmFtZSA9IHBpcGVNZXRhLnB1cmUgPyBgX3BpcGVfJHtuYW1lfWAgOiBgX3BpcGVfJHtuYW1lfV8ke3RoaXMucGlwZXMuc2l6ZX1gO1xuICAgIHZhciBwaXBlRXhwciA9IHRoaXMucGlwZXMuZ2V0KHBpcGVGaWVsZE5hbWUpO1xuICAgIGlmIChpc0JsYW5rKHBpcGVFeHByKSkge1xuICAgICAgdmFyIGRlcHMgPSBwaXBlTWV0YS50eXBlLmRpRGVwcy5tYXAoKGRpRGVwKSA9PiB7XG4gICAgICAgIGlmIChkaURlcC50b2tlbi5lcXVhbHNUbyhpZGVudGlmaWVyVG9rZW4oSWRlbnRpZmllcnMuQ2hhbmdlRGV0ZWN0b3JSZWYpKSkge1xuICAgICAgICAgIHJldHVybiBvLlRISVNfRVhQUi5wcm9wKCdyZWYnKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gaW5qZWN0RnJvbVZpZXdQYXJlbnRJbmplY3RvcihkaURlcC50b2tlbiwgZmFsc2UpO1xuICAgICAgfSk7XG4gICAgICB0aGlzLmZpZWxkcy5wdXNoKFxuICAgICAgICAgIG5ldyBvLkNsYXNzRmllbGQocGlwZUZpZWxkTmFtZSwgby5pbXBvcnRUeXBlKHBpcGVNZXRhLnR5cGUpLCBbby5TdG10TW9kaWZpZXIuUHJpdmF0ZV0pKTtcbiAgICAgIHRoaXMuY3JlYXRlTWV0aG9kLnJlc2V0RGVidWdJbmZvKG51bGwsIG51bGwpO1xuICAgICAgdGhpcy5jcmVhdGVNZXRob2QuYWRkU3RtdChvLlRISVNfRVhQUi5wcm9wKHBpcGVGaWVsZE5hbWUpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAuc2V0KG8uaW1wb3J0RXhwcihwaXBlTWV0YS50eXBlKS5pbnN0YW50aWF0ZShkZXBzKSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC50b1N0bXQoKSk7XG4gICAgICBwaXBlRXhwciA9IG8uVEhJU19FWFBSLnByb3AocGlwZUZpZWxkTmFtZSk7XG4gICAgICB0aGlzLnBpcGVzLnNldChwaXBlRmllbGROYW1lLCBwaXBlRXhwcik7XG4gICAgICBiaW5kUGlwZURlc3Ryb3lMaWZlY3ljbGVDYWxsYmFja3MocGlwZU1ldGEsIHBpcGVFeHByLCB0aGlzKTtcbiAgICB9XG4gICAgcmV0dXJuIHBpcGVFeHByO1xuICB9XG5cbiAgZ2V0VmFyaWFibGUobmFtZTogc3RyaW5nKTogby5FeHByZXNzaW9uIHtcbiAgICBpZiAobmFtZSA9PSBFdmVudEhhbmRsZXJWYXJzLmV2ZW50Lm5hbWUpIHtcbiAgICAgIHJldHVybiBFdmVudEhhbmRsZXJWYXJzLmV2ZW50O1xuICAgIH1cbiAgICB2YXIgY3VyclZpZXc6IENvbXBpbGVWaWV3ID0gdGhpcztcbiAgICB2YXIgcmVzdWx0ID0gY3VyclZpZXcudmFyaWFibGVzLmdldChuYW1lKTtcbiAgICB2YXIgdmlld1BhdGggPSBbXTtcbiAgICB3aGlsZSAoaXNCbGFuayhyZXN1bHQpICYmIGlzUHJlc2VudChjdXJyVmlldy5kZWNsYXJhdGlvbkVsZW1lbnQudmlldykpIHtcbiAgICAgIGN1cnJWaWV3ID0gY3VyclZpZXcuZGVjbGFyYXRpb25FbGVtZW50LnZpZXc7XG4gICAgICByZXN1bHQgPSBjdXJyVmlldy52YXJpYWJsZXMuZ2V0KG5hbWUpO1xuICAgICAgdmlld1BhdGgucHVzaChjdXJyVmlldyk7XG4gICAgfVxuICAgIGlmIChpc1ByZXNlbnQocmVzdWx0KSkge1xuICAgICAgcmV0dXJuIGdldFByb3BlcnR5SW5WaWV3KHJlc3VsdCwgdmlld1BhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICBjcmVhdGVMaXRlcmFsQXJyYXkodmFsdWVzOiBvLkV4cHJlc3Npb25bXSk6IG8uRXhwcmVzc2lvbiB7XG4gICAgcmV0dXJuIG8uVEhJU19FWFBSLmNhbGxNZXRob2QoJ2xpdGVyYWxBcnJheScsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgW28ubGl0ZXJhbCh0aGlzLmxpdGVyYWxBcnJheUNvdW50KyspLCBvLmxpdGVyYWxBcnIodmFsdWVzKV0pO1xuICB9XG4gIGNyZWF0ZUxpdGVyYWxNYXAodmFsdWVzOiBBcnJheTxBcnJheTxzdHJpbmcgfCBvLkV4cHJlc3Npb24+Pik6IG8uRXhwcmVzc2lvbiB7XG4gICAgcmV0dXJuIG8uVEhJU19FWFBSLmNhbGxNZXRob2QoJ2xpdGVyYWxNYXAnLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFtvLmxpdGVyYWwodGhpcy5saXRlcmFsTWFwQ291bnQrKyksIG8ubGl0ZXJhbE1hcCh2YWx1ZXMpXSk7XG4gIH1cblxuICBhZnRlck5vZGVzKCkge1xuICAgIHRoaXMudmlld1F1ZXJpZXMudmFsdWVzKCkuZm9yRWFjaChcbiAgICAgICAgKHF1ZXJpZXMpID0+IHF1ZXJpZXMuZm9yRWFjaCgocXVlcnkpID0+IHF1ZXJ5LmFmdGVyQ2hpbGRyZW4odGhpcy51cGRhdGVWaWV3UXVlcmllc01ldGhvZCkpKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBnZXRWaWV3VHlwZShjb21wb25lbnQ6IENvbXBpbGVEaXJlY3RpdmVNZXRhZGF0YSwgZW1iZWRkZWRUZW1wbGF0ZUluZGV4OiBudW1iZXIpOiBWaWV3VHlwZSB7XG4gIGlmIChlbWJlZGRlZFRlbXBsYXRlSW5kZXggPiAwKSB7XG4gICAgcmV0dXJuIFZpZXdUeXBlLkVNQkVEREVEO1xuICB9IGVsc2UgaWYgKGNvbXBvbmVudC50eXBlLmlzSG9zdCkge1xuICAgIHJldHVybiBWaWV3VHlwZS5IT1NUO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBWaWV3VHlwZS5DT01QT05FTlQ7XG4gIH1cbn1cbiJdfQ==