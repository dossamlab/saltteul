package kr.saltteul.app.widget;

/** 4x2: date, weather, nearest D-day, briefing line, three todos, shopping count. */
public class DashboardWidget extends BaseWidgetProvider {
    @Override
    protected String kind() {
        return WidgetLogic.KIND_DASHBOARD;
    }
}
